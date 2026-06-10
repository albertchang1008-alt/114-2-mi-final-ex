(function () {
  "use strict";

  var cfg = window.FIREBASE_V18_CONFIG || {};
  var app = null;
  var db = null;
  var auth = null;
  var boot = null;

  function hasUsableConfig() {
    var c = cfg.firebaseConfig || {};
    return !!(cfg.enabled && window.firebase && c.apiKey && c.projectId && c.authDomain && c.appId);
  }

  function init() {
    if (!hasUsableConfig()) return false;
    if (app && db && auth) return true;
    try {
      app = window.firebase.apps && window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(cfg.firebaseConfig);
      db = window.firebase.firestore(app);
      auth = window.firebase.auth(app);
      return true;
    } catch (err) {
      console.warn("[Firebase v1.81] 初始化失敗：", err);
      return false;
    }
  }

  function isEnabled() {
    return init();
  }

  function currentUserEmail() {
    return init() && auth.currentUser ? String(auth.currentUser.email || "").toLowerCase().trim() : "";
  }

  function safeDocId(value) {
    return String(value || "")
      .trim()
      .replace(/[^\w.-]/g, "_")
      .slice(0, 500) || String(Date.now());
  }

  function serverTimestamp() {
    return window.firebase.firestore.FieldValue.serverTimestamp();
  }

  function increment(n) {
    return window.firebase.firestore.FieldValue.increment(Number(n) || 0);
  }

  function docPath(path) {
    var parts = String(path || "").split("/").filter(Boolean);
    if (parts.length % 2 !== 0) throw new Error("Firestore 文件路徑不正確：" + path);
    var ref = db.collection(parts[0]).doc(parts[1]);
    for (var i = 2; i < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
    return ref;
  }

  function normalizeQuestion(doc) {
    var q = doc.data ? doc.data() : doc;
    return {
      id: q.id || doc.id || "",
      top: q.top || q.category || "未分類",
      q: q.q || q.question || "",
      options: Array.isArray(q.options) ? q.options : [q.optionA, q.optionB, q.optionC, q.optionD].filter(Boolean),
      ans: q.ans || q.answer || "",
      exp: q.exp || q.explanation || "尚無解析",
      color: q.color || "red",
      questionType: q.questionType || q.type || "",
      imgUrl: q.imgUrl || q.imageUrl || "",
      isImage: !!(q.isImage || q.imgUrl || q.imageUrl),
      cogType: q.cogType || "",
      source: q.source || "firebase",
      questionBankVersion: q.questionBankVersion || q.version || ""
    };
  }

  function uniqueTopics(questions) {
    var map = {};
    questions.forEach(function (q) {
      var name = q.top || "未分類";
      if (!map[name]) map[name] = { name: name, color: q.color || "red", count: 0 };
      map[name].count += 1;
    });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, "zh-TW"); }).map(function (k) { return map[k]; });
  }

  async function loadBootstrap() {
    if (!init()) return null;
    if (boot) return boot;
    var c = cfg.collections || {};
    
    var questions = [];
    try {
      var questionsDoc = await docPath(c.questionsDocument || "system/questions").get();
      if (questionsDoc.exists) {
        var qData = questionsDoc.data() || {};
        var qList = qData.questions || [];
        qList.forEach(function (q) {
          var normalized = normalizeQuestion(q);
          if (normalized.id && normalized.q) questions.push(normalized);
        });
      }
    } catch (err) {
      console.warn("[Firebase v1.81] 讀取題庫打包文件失敗，嘗試回退讀取舊 questions 集合：", err);
      try {
        var questionsSnap = await db.collection(c.questions || "questions").get();
        questionsSnap.forEach(function (doc) {
          var q = normalizeQuestion(doc);
          if (q.id && q.q) questions.push(q);
        });
      } catch (fallbackErr) {
        console.error("[Firebase v1.81] 舊 questions 集合讀取也失敗：", fallbackErr);
      }
    }
    if (!questions.length) return null;

    var settings = {};
    var rankingCache = null;
    try {
      var settingsDoc = await docPath(c.settings || "system/main").get();
      if (settingsDoc.exists) settings = settingsDoc.data() || {};
    } catch (err) {
      console.warn("[Firebase v1.81] 設定讀取失敗：", err);
    }
    try {
      var rankingDoc = await docPath(c.homeRanking || "rankingCaches/home").get();
      if (rankingDoc.exists) rankingCache = rankingDoc.data() || null;
    } catch (err) {
      console.warn("[Firebase v1.81] 排行快取讀取失敗：", err);
    }

    boot = {
      status: "success",
      source: "firebase",
      title: settings.title || "動態題庫測驗",
      titleColor: settings.titleColor || "sky",
      topics: settings.topics || uniqueTopics(questions),
      questions: questions,
      completionSettings: settings.completionSettings || settings,
      allClassList: settings.allClassList || [],
      deadline: settings.deadline || "",
      campusDeadlines: settings.campusDeadlines || {},
      rankingCache: rankingCache,
      questionBankVersion: settings.questionBankVersion || ""
    };
    return boot;
  }

  async function signInWithGoogle() {
    if (!init()) throw new Error("Firebase 尚未啟用");
    var provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    var result = await auth.signInWithPopup(provider);
    return result.user;
  }

  async function findStudentByEmail(email) {
    if (!init()) return null;
    var c = cfg.collections || {};
    var target = String(email || "").toLowerCase().trim();
    if (!target) return null;
    var snap = await db.collection(c.students || "students").where("emailLower", "==", target).limit(1).get();
    if (!snap.empty) {
      var data = snap.docs[0].data();
      return {
        exists: true,
        studentId: data.studentId || snap.docs[0].id,
        name: data.name || data.studentName || data.studentId || snap.docs[0].id,
        className: data.className || data.class || "未分班"
      };
    }
    var prefix = target.split("@")[0];
    if (prefix) {
      var doc = await db.collection(c.students || "students").doc(prefix).get();
      if (doc.exists) {
        var d = doc.data();
        return { exists: true, studentId: d.studentId || prefix, name: d.name || prefix, className: d.className || "未分班" };
      }
    }
    return { exists: false, message: "查無學生資料，請確認 Email 是否已在學生名單" };
  }

  function groupByCategory(questions) {
    var map = {};
    questions.forEach(function (q) {
      var key = q.top || "未分類";
      if (!map[key]) map[key] = [];
      map[key].push(q);
    });
    return map;
  }

  async function getQuizByCount(payload) {
    var data = await loadBootstrap();
    if (!data || !data.questions) return null;
    var count = Math.max(1, Number(payload && payload.count) || 30);
    var excluded = new Set((payload && payload.excludeIds) || []);
    var groups = groupByCategory(data.questions.filter(function (q) { return !excluded.has(q.id); }));
    var keys = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, "zh-TW"); });
    var picked = [];
    var cursor = 0;
    keys.forEach(function (key) { groups[key].sort(function () { return Math.random() - 0.5; }); });
    while (picked.length < count && keys.length) {
      var key = keys[cursor % keys.length];
      var next = groups[key].shift();
      if (next) picked.push(next);
      keys = keys.filter(function (k) { return groups[k] && groups[k].length; });
      cursor += 1;
    }
    return {
      status: "ok",
      data: picked,
      batchId: "FB_" + Date.now(),
      questionBankVersion: data.questionBankVersion || "",
      settingsVersion: "firebase-v1.81"
    };
  }

  function buildBatchId(payload) {
    return safeDocId(payload.batchId || [
      "FB",
      payload.studentId || "student",
      payload.mode || "practice",
      Date.now()
    ].join("_"));
  }

  function normalizeDetail(detail, payload, idx, batchId) {
    var isCorrect = detail.isCorrect === true;
    return {
      batchId: batchId,
      email: payload.email || currentUserEmail(),
      studentId: payload.studentId || "",
      name: payload.name || "",
      className: payload.className || "",
      mode: payload.mode || "",
      attempt: Number(payload.attempt || 1),
      questionId: detail.questionId || "",
      questionText: detail.questionText || "",
      topic: detail.topic || "",
      questionType: detail.questionType || "",
      cogType: detail.cogType || "",
      order: Number(detail.order || idx + 1),
      selectedText: detail.selectedText || "未作答",
      correctText: detail.correctText || "",
      isCorrect: isCorrect,
      answerSec: detail.answerSec === null || detail.answerSec === undefined ? null : Number(detail.answerSec) || 0,
      source: detail.source || "firebase",
      isFirstAttempt: detail.isFirstAttempt !== false,
      questionBankVersion: payload.questionBankVersion || "",
      settingsVersion: payload.settingsVersion || "",
      createdAt: serverTimestamp()
    };
  }

  async function submitAttempt(payload) {
    if (!init()) throw new Error("Firebase 尚未啟用");
    if (!auth.currentUser) throw new Error("尚未完成 Firebase Google 登入");
    payload = payload || {};
    var c = cfg.collections || {};
    var email = String(payload.email || auth.currentUser.email || "").toLowerCase().trim();
    if (!email || email !== currentUserEmail()) throw new Error("登入帳號與作答資料不一致");
    var details = Array.isArray(payload.details) ? payload.details : [];
    if (!details.length) throw new Error("沒有可寫入的作答明細");

    var batchId = buildBatchId(payload);
    var batch = db.batch();
    var now = serverTimestamp();
    var duration = Number(payload.duration || 0);

    // 優化寫入：將作答明細打包存入 details 欄位，並將 createdAt 改用 ISO 字串
    var cleanDetails = details.map(function (detail, idx) {
      var d = normalizeDetail(detail, { ...payload, email: email }, idx, batchId);
      d.createdAt = new Date().toISOString(); // 避免在陣列中使用 serverTimestamp 限制
      return d;
    });

    batch.set(db.collection(c.answerBatches || "answerBatches").doc(batchId), {
      batchId: batchId,
      email: email,
      studentId: payload.studentId || "",
      name: payload.name || "",
      className: payload.className || "",
      topic: payload.topic || "",
      mode: payload.mode || "",
      attempt: Number(payload.attempt || 1),
      questionCount: details.length,
      score: Number(payload.score || 0),
      correctCount: Number(payload.correctCount || 0),
      wrongCount: Number(payload.wrongCount || 0),
      duration: duration,
      questionIds: details.map(function (d) { return d.questionId || ""; }).filter(Boolean),
      questionBankVersion: payload.questionBankVersion || "",
      settingsVersion: payload.settingsVersion || "",
      source: "student-firebase-v1.81",
      startedAtClient: payload.startedAt || null,
      endedAtClient: payload.endedAt || new Date().toISOString(),
      createdAt: now,
      details: cleanDetails // 嵌入作答明細陣列，省去額外集合寫入
    });

    // 已將所有資料整併，無需再針對 answerDetails, studentProgress, wrongQuestions 進行迴圈寫入，大幅降低寫入次數。

    await batch.commit();
    return { status: "ok", batchId: batchId, writtenDetails: details.length };
  }

  function queueKey() {
    return "quiz_v181_pending_attempts";
  }

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(queueKey()) || "[]"); }
    catch (_) { return []; }
  }

  function writeQueue(items) {
    localStorage.setItem(queueKey(), JSON.stringify(items || []));
  }

  async function flushQueue() {
    var queue = readQueue();
    if (!queue.length) return { status: "ok", flushed: 0 };
    var remaining = [];
    var flushed = 0;
    for (var i = 0; i < queue.length; i++) {
      try {
        await submitAttempt(queue[i].payload);
        flushed += 1;
      } catch (err) {
        remaining.push(queue[i]);
      }
    }
    writeQueue(remaining);
    return { status: "ok", flushed: flushed, remaining: remaining.length };
  }

  async function submitAttemptWithFallback(payload) {
    try {
      await flushQueue();
      return await submitAttempt(payload);
    } catch (err) {
      var queue = readQueue();
      queue.push({ payload: payload, queuedAt: new Date().toISOString(), error: err.message || String(err) });
      writeQueue(queue.slice(-20));
      console.warn("[Firebase v1.81] 作答暫存於本機，稍後重送：", err);
      return { status: "queued", message: "已暫存在本機，稍後會自動重送" };
    }
  }

  window.FirebaseV18 = {
    isEnabled: isEnabled,
    init: init,
    currentUserEmail: currentUserEmail,
    loadBootstrap: loadBootstrap,
    signInWithGoogle: signInWithGoogle,
    findStudentByEmail: findStudentByEmail,
    getQuizByCount: getQuizByCount,
    submitAttempt: submitAttempt,
    submitAttemptWithFallback: submitAttemptWithFallback,
    flushQueue: flushQueue
  };
})();
