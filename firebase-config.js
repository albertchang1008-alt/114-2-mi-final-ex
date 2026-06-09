// Firebase v1.8 設定檔
// 1. 到 Firebase Console 建立 Web App。
// 2. 將 Firebase SDK config 貼到 firebaseConfig。
// 3. 將 enabled 改成 true 後，學生端會優先讀 Firebase；失敗時仍會回退 GAS。
window.FIREBASE_V18_CONFIG = {
  enabled: true,
  firebaseConfig: {
    apiKey: "AIzaSyAQ6O5HiixemS1J0wA2eRKs7YWXzHUowF0",
    authDomain: "mi-final-exam-2750a.firebaseapp.com",
    projectId: "mi-final-exam-2750a",
    storageBucket: "mi-final-exam-2750a.firebasestorage.app",
    messagingSenderId: "148804958980",
    appId: "1:148804958980:web:bb5008ea9033e552ecee51"
  },
  collections: {
    questions: "questions",
    students: "students",
    settings: "system/main",
    homeRanking: "rankingCaches/home",
    answerBatches: "answerBatches",
    answerDetails: "answerDetails"
  }
};
