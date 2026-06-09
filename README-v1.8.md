# 題庫系統 v1.8：Firebase + Google Sheet

## 架構

- Google Sheet：老師入口，管理題庫、學生名單、系統設定、校區倒數時間。
- GAS：從 Google Sheet 產生同步資料包，也保留原本學生端備援 API。
- Firebase Firestore：學生端主要讀取來源，快速載入題庫、設定、排行、學生名單。
- Firebase Authentication：學生使用 Google 帳號登入，登入後依 `學生名單` 中的 Email 比對身分。

## 啟用步驟

1. 建立 Firebase 專案，啟用 Authentication 的 Google provider。
2. 建立 Web App，將 SDK config 貼到 `firebase-config.js`。
3. 將 `firebase-config.js` 的 `enabled` 改成 `true`。
4. 部署 Firestore rules/indexes。
5. 從 GAS 或後台同步 Google Sheet 資料到 Firestore。

## Firestore 建議集合

- `system/main`：標題、完成度設定、校區倒數、登入頁設定。
- `questions/{questionId}`：題庫快取。
- `students/{studentId}`：學生名單，需包含 `emailLower`。
- `rankingCaches/home`：登入頁排行與公告快取。
- `answerDetails/{docId}`：學生作答明細鏡像。
- `answerBatches/{batchId}`：作答批次鏡像。

## 回退機制

如果 Firebase 未設定、讀取失敗或 Firestore 沒資料，前端會自動改用原本 GAS。
