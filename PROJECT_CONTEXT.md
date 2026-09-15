# 資金諮詢落地頁：專案上下文

## 專案用途

臺灣地區貸款媒合／資金諮詢落地頁。訪客選擇資金需求額度、填寫資料後加入 LINE；專員在 CRM 追蹤線索狀態，並將深層轉換回傳 TikTok。

## 正式環境

- 網站：https://funding-consultation-landing-page.vercel.app/
- CRM：https://funding-consultation-landing-page.vercel.app/crm.html
- Vercel 專案：`funding-consultation-landing-page`
- Vercel Team：`kinkman1`
- Supabase 專案 ref：`tcrqdyzxiodqdgmeeuxf`

## 主要檔案

- `index.html`：訪客落地頁與 Meta／TikTok Pixel 基礎碼。
- `script.js`：額度選擇、表單送出、TikTok 瀏覽器事件、LINE 跳轉。
- `api/leads/index.js`：接收表單並寫入 Supabase；IP 雜湊僅供後台排查，不限制重複提交。
- `crm.html`、`crm.js`、`crm.css`：專員 CRM。
- `api/admin/leads.js`：讀取線索。
- `api/admin/leads/[id]/status.js`：更新 CRM 狀態並觸發 TikTok 服務端深層事件。
- `api/_lib/supabase.js`：Supabase 服務端存取與 CRM 人員權限驗證。
- `api/_lib/tiktok.js`：TikTok Events API 回傳。
- `auth.html`、`auth.js`：CRM 密碼重設後的密碼設定頁。
- `supabase/migrations/20260901000000_create_lead_crm.sql`：資料庫結構。

## 訪客與線索流程

1. 訪客選擇額度：10萬-30萬、30萬-80萬、80萬-180萬、180萬-300萬。
2. 訪客提交姓名、年齡、電話、警示戶與已同意資料使用。
3. 前端呼叫 `POST /api/leads`，服務端將資料存入 `leads`，初始狀態為「新線索」。
4. 成功後顯示諮詢編號；訪客點擊加入 LINE 時，前端呼叫 `POST /api/leads/:id/line-click` 將狀態更新為「已點擊加入 LINE」：`https://lin.ee/NdxqFfd`。
5. CRM 專員將線索標記為已聯絡、有效諮詢、成交或無效。

CRM 預設顯示臺灣時區（UTC+8）的當日線索；可選擇任一提交日期篩選，統計卡會顯示該日成功提交的表單總數。

## 資料庫與權限

Supabase 資料表：

- `leads`：原始線索與目前狀態。
- `lead_status_events`：狀態歷程與 TikTok 回傳結果。
- `crm_staff`：可登入 CRM 的專員白名單。

資料表已啟用 RLS，匿名與一般已驗證使用者沒有直接讀寫權限。CRM API 會先驗證 Supabase session，再檢查 `crm_staff`。

`client_ip_hash` 為每筆提交各自加鹽的匿名值，不作為重複提交限制。IP 不以明文保存。

## 事件回傳

### Meta Pixel

- Pixel ID：`2506070169900710`
- 現有事件：`PageView`

### Meta Conversions API（由 CRM 服務端觸發）

- `contacted` → `Contact`
- `qualified` → `Lead`
- `won` → 僅保留於 CRM，不回傳 Meta。

Meta 回傳使用 `fbp`、`fbc`、IP 與瀏覽器標識；不會傳送表單中的姓名、電話、年齡或警示戶資料。回傳結果保存在 `lead_status_events.tiktok_response.meta`。

### TikTok Pixel

- Pixel ID：`DA3D8QJC77UBMOG4P550`
- `PageView`：頁面載入。
- `ViewContent`：訪客確認額度並進入申請頁。
- `Lead`：表單已成功寫入服務端後觸發。

### TikTok Events API（由 CRM 服務端觸發）

- `contacted` → `Contact`
- `qualified` → `SubmitApplication`
- `won` → `ApplicationApproval`
- `lost` → 不回傳 TikTok 事件。

瀏覽器端不再發送 `Contact`，避免與 CRM「已聯絡」重複計數。

目前 TikTok 僅接收 `ttclid`、線索 ID、管線狀態與頁面 URL；不會傳送姓名、電話、年齡或警示戶資料。

## 環境變數

以下環境變數僅應設定於 Vercel，禁止寫入程式碼、Git 或此文件：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` 或 `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` 或 `SUPABASE_SERVICE_ROLE_KEY`
- `LEAD_HASH_SALT`
- `TIKTOK_PIXEL_CODE`
- `TIKTOK_EVENTS_API_TOKEN`
- `META_PIXEL_ID`
- `META_CAPI_ACCESS_TOKEN`
- `META_GRAPH_API_VERSION`（選填；預設 `v23.0`）
- `SITE_URL`

## 密碼重設

- CRM 按「忘記密碼」會使用 Supabase Auth 寄送重設信。
- Supabase 內建寄信服務有每小時 2 封認證信的限制；若看到 `email rate limit exceeded`，須等待額度恢復或設定自有 SMTP。
- Supabase Auth 的 Site URL 與 Redirect URLs 必須保留已部署的 Vercel 網址；不要填入 `localhost`。

## 部署與驗證

部署生產環境：

```powershell
vercel deploy . --prod --scope kinkman1 --yes --no-wait
```

部署後確認：

```powershell
vercel inspect <deployment-url> --scope kinkman1
```

每次修改回傳邏輯後，至少檢查：

1. JavaScript 語法：`node --check <file>`。
2. CRM 可登入、可讀取線索、可更新狀態。
3. `lead_status_events` 是否記錄 TikTok 回傳結果。
4. TikTok Events Manager 的測試事件與正式事件是否收到。

## 維護注意事項

- 金融服務頁面涉及個人資料；變更資料欄位、像素匹配資料或受眾上傳前，先確認隱私告知與合法依據。
- 不要把 TikTok、Supabase、Vercel token 或客戶資料貼入 Git、Markdown、截圖或公開對話。
- TikTok Events API 回應應以其業務成功碼確認；HTTP 200 不必然代表事件已被 TikTok 接受。
