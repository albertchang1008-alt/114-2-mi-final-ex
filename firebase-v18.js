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
      console.warn("[Firebase v1.8] 初始化失敗，改用 GAS：", err);
      return false;
    }
  }

  function isEnabled() {
    return init();
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
    var questionsSnap = await db.collection(c.questions || "questions").get();
    var questions = [];
    questionsSnap.forEach(function (doc) {
      var q = normalizeQuestion(doc);
      if (q.id && q.q) questions.push(q);
    });
    if (!questions.length) return null;

    var settings = {};
    var rankingCache = null;
    try {
      var settingsDoc = await docPath(c.settings || "system/main").get();
      if (settingsDoc.exists) settings = settingsDoc.data() || {};
    } catch (err) {
      console.warn("[Firebase v1.8] 設定讀取失敗：", err);
    }
    try {
      var rankingDoc = await docPath(c.homeRanking || "rankingCaches/home").get();
      if (rankingDoc.exists) rankingCache = rankingDoc.data() || null;
    } catch (err) {
      console.warn("[Firebase v1.8] 排行快取讀取失敗：", err);
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
      settingsVersion: "firebase-v1.8"
    };
  }

  async function mirrorAnswerDetail(detail) {
    if (!init() || !auth.currentUser) return;
    var c = cfg.collections || {};
    var id = [
      detail.batchId || "batch",
      detail.studentId || auth.currentUser.uid,
      detail.questionId || detail.qid || Date.now()
    ].join("_").replace(/[^\w.-]/g, "_");
    await db.collection(c.answerDetails || "answerDetails").doc(id).set({
      ...detail,
      email: auth.currentUser.email || "",
      clientWrittenAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  window.FirebaseV18 = {
    isEnabled: isEnabled,
    init: init,
    loadBootstrap: loadBootstrap,
    signInWithGoogle: signInWithGoogle,
    findStudentByEmail: findStudentByEmail,
    getQuizByCount: getQuizByCount,
    mirrorAnswerDetail: mirrorAnswerDetail
  };
})();
