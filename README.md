# 資金諮詢落地頁

手機優先的資金試算與諮詢落地頁。首頁試算後進入 `contact.html` 填寫表單，表單由 `/api/leads` 接收並寫入 Supabase。

## 本機預覽

以本機網站服務器開啟 `index.html` 預覽。直接用檔案網址開啟時，無法測試 `/api/leads`。

## 部署

本專案部署於 Vercel，並使用現有 Supabase CRM。正式設定與事件流程見 `PROJECT_CONTEXT.md`。
