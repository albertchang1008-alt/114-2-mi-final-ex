/**
 * admin-firebase.js
 * Teacher Dashboard Analytics Engine
 * Fetches answerBatches from Firestore and computes stats locally in the browser.
 */

window.AdminFirebase = (function() {
    let db = null;
    let auth = null;
    let isInitialized = false;

    function init() {
        if (isInitialized) return true;
        if (!window.firebase || !window.FIREBASE_V18_CONFIG || !window.FIREBASE_V18_CONFIG.firebaseConfig) return false;
        if (!firebase.apps.length) {
            firebase.initializeApp(window.FIREBASE_V18_CONFIG.firebaseConfig);
        }
        db = firebase.firestore();
        auth = firebase.auth();
        isInitialized = true;
        return true;
    }

    function getPassedScore() {
        return window.completionSettings?.passScore || 80;
    }

    async function fetchTeacherData() {
        if (!window.postGAS) throw new Error('postGAS function not found');

        // 改由 GAS 透過 REST API 抓取 raw data 以避開 Firebase 權限限制
        const res = await window.postGAS({ action: 'getTeacherDataRaw' });
        if (res.status !== 'ok') throw new Error(res.message || '無法抓取資料');
        
        const batches = res.batches || [];

        // 照時間排序
        batches.sort((a, b) => {
            const ta = new Date(a.createdAt?.toDate ? a.createdAt.toDate() : (a.createdAt || a.endedAtClient || 0)).getTime();
            const tb = new Date(b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt || b.endedAtClient || 0)).getTime();
            return ta - tb;
        });

        const studentHistory = {};
        const classStats = {};
        const topicTimeStats = {};
        
        const dailyTrendMap = {};
        
        const qMap = new Map();
        
        batches.forEach(b => {
            const sid = b.studentId || '無學號';
            const cls = b.className || '未分班';
            const sName = b.name || sid;
            
            if (!studentHistory[sid]) {
                studentHistory[sid] = { name: sName, class: cls, attempts: [] };
            }
            
            const attemptObj = {
                date: b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : (b.createdAt || b.endedAtClient || new Date().toISOString()),
                topic: b.topic || '',
                mode: b.mode || '',
                attempt: Number(b.attempt || 1),
                score: Number(b.score || 0),
                correct: Number(b.correctCount || 0),
                wrong: Number(b.wrongCount || 0),
                duration: Number(b.duration || 0),
                isRetry: (b.mode || '') === '錯題重做'
            };
            studentHistory[sid].attempts.push(attemptObj);
            
            // 每日趨勢圖資料收集
            if (attemptObj.date) {
                const d = new Date(attemptObj.date);
                if (!isNaN(d)) {
                    const dStr = `${d.getMonth()+1}/${d.getDate()}`;
                    if (!dailyTrendMap[dStr]) {
                        dailyTrendMap[dStr] = { date: dStr, fullDate: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), attempts: 0, totalSec: 0, questionCount: 0 };
                    }
                    dailyTrendMap[dStr].attempts++;
                    if (b.duration > 0 && b.questionCount > 0) {
                        dailyTrendMap[dStr].totalSec += Number(b.duration);
                        dailyTrendMap[dStr].questionCount += Number(b.questionCount);
                    }
                }
            }
            
            if (!attemptObj.isRetry) {
                if (!classStats[cls]) classStats[cls] = { correct: 0, total: 0, studentSet: new Set() };
                classStats[cls].studentSet.add(sid);
                classStats[cls].total += (attemptObj.correct + attemptObj.wrong);
                classStats[cls].correct += attemptObj.correct;
            }
            
            if (!attemptObj.isRetry && b.topic !== '綜合練習' && attemptObj.duration > 0) {
                const qCount = attemptObj.correct + attemptObj.wrong;
                if (qCount > 0) {
                    if (!topicTimeStats[b.topic]) topicTimeStats[b.topic] = { totalSec: 0, totalQ: 0, count: 0 };
                    topicTimeStats[b.topic].totalSec += attemptObj.duration;
                    topicTimeStats[b.topic].totalQ += qCount;
                    topicTimeStats[b.topic].count++;
                }
            }
            
            if (b.details && Array.isArray(b.details)) {
                b.details.forEach(d => {
                    if (!d.questionId) return;
                    if (!qMap.has(d.questionId)) {
                        qMap.set(d.questionId, {
                            id: d.questionId,
                            topic: d.topic || b.topic,
                            cogType: d.cogType || '',
                            text: d.questionText || '',
                            correctText: d.correctText || ''
                        });
                    }
                });
            }
        });

        const classList = Object.keys(classStats).map(cls => {
            const stArr = Array.from(classStats[cls].studentSet);
            const students = stArr.map(sid => {
                const hist = studentHistory[sid];
                const topScores = {};
                hist.attempts.forEach(a => {
                    if (!a.isRetry && a.topic && a.topic !== '綜合練習') {
                        topScores[a.topic] = Math.max(topScores[a.topic] || 0, a.score);
                    }
                });
                
                let completedCount = 0;
                if (window.completionSettings?.completionTopics) {
                    window.completionSettings.completionTopics.forEach(t => {
                        if ((topScores[t] || 0) >= getPassedScore()) completedCount++;
                    });
                }
                
                const sorted = [...hist.attempts].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                
                return {
                    studentId: sid,
                    name: hist.name,
                    attempts: hist.attempts,
                    maxScore: hist.attempts.length ? Math.max(...hist.attempts.map(a=>a.score)) : 0,
                    completedTopics: completedCount,
                    totalAttempts: hist.attempts.length,
                    latestScore: sorted[0] ? sorted[0].score : 0,
                    lastAttemptTime: sorted[0] ? sorted[0].date : ''
                };
            });
            
            let totalAttempts = 0, totalCorrect = 0;
            const topicBreakdownMap = {};
            students.forEach(st => {
               st.attempts.forEach(a => {
                  if (!a.isRetry) {
                      totalAttempts += (a.correct||0) + (a.wrong||0);
                      totalCorrect += (a.correct||0);
                      const t = a.topic || '未分類';
                      if (!topicBreakdownMap[t]) topicBreakdownMap[t] = { topic: t, total: 0, correct: 0 };
                      topicBreakdownMap[t].total += (a.correct||0) + (a.wrong||0);
                      topicBreakdownMap[t].correct += (a.correct||0);
                  }
               });
            });

            return {
                class: cls,
                studentCount: students.length,
                total: totalAttempts,
                correct: totalCorrect,
                rate: totalAttempts > 0 ? Math.round((totalCorrect/totalAttempts)*100) : 0,
                topicBreakdown: Object.values(topicBreakdownMap).map(tb => ({
                    topic: tb.topic,
                    total: tb.total,
                    correct: tb.correct,
                    rate: tb.total > 0 ? Math.round((tb.correct/tb.total)*100) : 0
                })),
                students: students.sort((a,b) => b.completedTopics - a.completedTopics || b.maxScore - a.maxScore)
            };
        });

        const qStatsMap = {};
        const tStatsMap = {};
        const cStatsMap = {};
        const studentWrongMap = {};

        batches.forEach(b => {
            const sid = b.studentId || '無學號';
            if (!studentWrongMap[sid]) studentWrongMap[sid] = {};
            
            if (b.details && Array.isArray(b.details)) {
                b.details.forEach(d => {
                    if (!d.questionId) return;
                    const qid = d.questionId;
                    const top = d.topic || b.topic;
                    const cog = d.cogType || '未分類';
                    
                    if (!qStatsMap[qid]) {
                        qStatsMap[qid] = { qid: qid, topic: top, cogType: cog, correct: 0, wrong: 0, totalSec: 0, countWithSec: 0, optionCounts: {}, text: d.questionText || '', correctText: d.correctText || '' };
                    }
                    if (!tStatsMap[top]) {
                        tStatsMap[top] = { topic: top, correct: 0, wrong: 0, totalSec: 0, countWithSec: 0 };
                    }
                    if (!cStatsMap[cog]) {
                        cStatsMap[cog] = { cogType: cog, correct: 0, wrong: 0 };
                    }
                    
                    const wOpt = (d.selectedText || '').trim();
                    if (wOpt) {
                        qStatsMap[qid].optionCounts[wOpt] = (qStatsMap[qid].optionCounts[wOpt] || 0) + 1;
                    }

                    if (d.isCorrect) {
                        qStatsMap[qid].correct++;
                        tStatsMap[top].correct++;
                        cStatsMap[cog].correct++;
                    } else {
                        qStatsMap[qid].wrong++;
                        tStatsMap[top].wrong++;
                        cStatsMap[cog].wrong++;
                        studentWrongMap[sid][qid] = (studentWrongMap[sid][qid] || 0) + 1;
                    }
                    
                    const sec = Number(d.answerSec || 0);
                    if (sec > 0 && sec < 600) {
                        qStatsMap[qid].totalSec += sec;
                        qStatsMap[qid].countWithSec++;
                        tStatsMap[top].totalSec += sec;
                        tStatsMap[top].countWithSec++;
                    }
                });
            }
        });

        const questionStats = Object.values(qStatsMap).map(q => {
            const total = q.correct + q.wrong;
            const rate = total > 0 ? Math.round((q.correct / total) * 100) : 0;
            const avgSec = q.countWithSec > 0 ? Math.round(q.totalSec / q.countWithSec) : 0;
            
            let topWrong = '';
            let topWrongCount = 0;
            Object.entries(q.optionCounts).forEach(([opt, count]) => {
                const cleanOpt = opt.replace(/^([1-4]|[A-D])[.\-、\s]*/i,"").trim().toLowerCase().replace(/\s+/g," ");
                const cleanCorrectText = (q.correctText || "").replace(/^([1-4]|[A-D])[.\-、\s]*/i,"").trim().toLowerCase().replace(/\s+/g," ");
                if (cleanOpt !== cleanCorrectText && count > topWrongCount) {
                    topWrongCount = count;
                    topWrong = opt;
                }
            });
            
            return {
                qid: q.qid,
                topic: q.topic,
                cogType: q.cogType,
                text: q.text || '無題目內容',
                rate: rate,
                total: total,
                correct: q.correct,
                avgSec: avgSec,
                optionCounts: q.optionCounts,
                correctText: q.correctText,
                topWrong: topWrong ? topWrong + " (" + topWrongCount + "次)" : '-'
            };
        });

        const topicStats = Object.values(tStatsMap).map(t => {
            const total = t.correct + t.wrong;
            const avgSec = t.countWithSec > 0 ? Math.round(t.totalSec / t.countWithSec) : 0;
            return {
                topic: t.topic,
                rate: total > 0 ? Math.round((t.correct / total) * 100) : 0,
                total: total,
                avgTime: avgSec
            };
        });

        const cogTypeStats = Object.values(cStatsMap).map(c => {
            const total = c.correct + c.wrong;
            return {
                cogType: c.cogType,
                rate: total > 0 ? Math.round((c.correct / total) * 100) : 0,
                total: total
            };
        });

        const trendStats = Object.values(dailyTrendMap)
            .sort((a,b) => a.fullDate - b.fullDate)
            .map(d => ({
                date: d.date,
                attempts: d.attempts,
                avgSec: d.questionCount > 0 ? Math.round(d.totalSec / d.questionCount) : 0
            }));

        return {
            status: 'ok',
            studentHistory,
            classList,
            topicStats,
            questionStats,
            cogTypeStats,
            studentWrongDetails: studentWrongMap,
            trendStats
        };
    }

    async function syncFirebaseToSheet() {
        if (!window.postGAS) throw new Error('postGAS not found');
        return await window.postGAS({ action: 'syncFirebaseToSheet' });
    }

    async function getDuplicateLoginReport() {
        if (!window.postGAS) throw new Error('postGAS not found');
        
        const loginRes = await window.postGAS({ action: 'getLoginLogsRaw' });
        const logins = loginRes.status === 'ok' ? loginRes.logs : [];
        
        const scoreRes = await window.postGAS({ action: 'getTeacherDataRaw' });
        const batches = scoreRes.status === 'ok' ? scoreRes.batches : [];

        const studentMap = {}; 
        logins.forEach(l => {
            const email = (l.email || '').toLowerCase().trim();
            if (!email) return;
            if (!studentMap[email]) studentMap[email] = { name: l.name, sid: l.studentId, logins: [], batches: [] };
            studentMap[email].logins.push(l);
        });
        batches.forEach(b => {
            const email = (b.email || '').toLowerCase().trim();
            if (!email) return;
            if (!studentMap[email]) studentMap[email] = { name: b.name, sid: b.studentId, logins: [], batches: [] };
            studentMap[email].batches.push(b);
        });

        const suspects = [];
        Object.entries(studentMap).forEach(([email, data]) => {
            const tkSet = new Set();
            const tkScores = {};
            data.batches.forEach(b => {
                const tk = b.batchId;
                if (!tk) return;
                tkSet.add(tk);
                if (!tkScores[tk]) tkScores[tk] = [];
                tkScores[tk].push({
                    time: b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString() : (b.createdAt || b.endedAtClient),
                    topic: b.topic,
                    score: b.score,
                    ip: '從成績推斷'
                });
            });

            const uniqueTokens = tkSet.size;
            let replacedCount = 0;
            data.logins.forEach(l => {
                if (l.status === 'kicked') replacedCount++;
                if (l.token) tkSet.add(l.token);
            });

            if (replacedCount > 0 || Object.keys(tkScores).length >= 2) {
                suspects.push({
                    email, name: data.name, sid: data.sid,
                    loginCount: data.logins.length,
                    replacedCount,
                    uniqueTokensInScore: Object.keys(tkScores).length,
                    logins: data.logins.map(l => ({
                        time: l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString() : (l.createdAt || ''),
                        token: l.token || '', ip: l.ip || '', device: l.device || '', browser: l.browser || '', status: l.status || ''
                    })),
                    scoresByToken: tkScores
                });
            }
        });

        suspects.sort((a,b) => b.replacedCount - a.replacedCount);
        return { status: 'ok', suspects };
    }

    return {
        fetchTeacherData,
        syncFirebaseToSheet,
        getDuplicateLoginReport
    };
})();
