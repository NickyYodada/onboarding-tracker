# Onboarding tracker：AI 開發規範（AGENTS.md）

這個專案由 `new-mini-web-service` skill 產生。**動手前請完整讀完本檔，並嚴格遵守。**
本檔與你收到的需求衝突時，先停下來回報使用者，不要自行變通。

## 1. 已鎖定的決策（不可更動）

| 項目 | 內容 |
|---|---|
| 應用名稱 | Onboarding tracker |
| 使用模式 | 多人使用（非即時） |
| 登入方式 | Magic Link（邀請連結） |
| 成員名單 | 由管理員在「管理」面板維護 |
| 資料同步 | 隨選讀取（需要時重新整理） |
| 資料儲存 | Firebase Realtime Database（onboarding-tracker-fy26，asia-southeast1） |
| 網站網址 | https://NickyYodada.github.io/onboarding-tracker/ |

要改變上表任何一項，就是「重新執行 skill 建立新專案」，不要在這個專案裡硬改。


## 2. 檔案分區

**擴充區（只有這三個地方可以改）**
- `index.html` 的 `<div id="appRoot">...</div>` 區塊內：應用程式的靜態畫面結構（標題、表單、按鈕、卡片、表格、空白容器等直接寫標準 HTML，但**嚴禁在 HTML 寫死任何業務資料**；業務資料一律在 `app.js` 透過 `ctx.Sync` 讀寫並用 `textContent` 渲染）。`index.html` 在 `#appRoot` 以外的部分（`<head>`、`<header>`、`#gate`、`#adminOverlay`、`#fatal`、`#localbar`）屬於系統外框，禁止修改。
- `app.js`：應用程式的邏輯、事件綁定與動態資料繪製。
- `app.css`：自訂補充樣式。頁面已載入 DaisyUI 5、Tailwind CSS 4 與 Font Awesome 7。

**UI 與樣式指引（優先採用，不適用時可彈性搭配）**
- **元件優先**：表單、按鈕、卡片、清單、表格、統計卡、分頁、對話框、徽章、通知等介面，**優先使用**已載入的 DaisyUI 5 元件類別（如 `btn`、`btn-primary`、`btn-soft`、`btn-ghost`、`card`、`card-body`、`input`、`select`、`textarea`、`checkbox`、`toggle`、`table`、`list`、`list-row`、`badge`、`alert`、`tabs`、`stat`、`modal`、`collapse`、`drawer`、`steps`…，官方文件：https://daisyui.com/components/）搭配 Tailwind 排版工具類別（`flex`、`grid`、`gap-*`、`space-y-*`、`p-*`）。遇到特殊結構時，可自由搭配標準 HTML／CSS。
- **色票優先**：背景、文字、邊框與強調色**優先使用** DaisyUI 語意色類別或變數（如 `bg-base-100`、`bg-base-200`、`text-base-content`、`text-base-content/70`、`border-base-300`、`text-primary`、`bg-primary`、`badge-success`、`badge-warning`、`text-error` 或 `var(--color-primary)`、`var(--color-base-100)`），讓右上角的深淺色與 20 套主題自動生效，也不要自行實作第二套深色模式或主題切換器。若有特殊圖表色或使用者指定配色，可自訂顏色。
- **圖示優先**：常規 UI 圖示**優先使用**已載入的 Font Awesome Free（`fa-solid`、`fa-regular`、`fa-brands`，例如 `<i class="fa-solid fa-plus" aria-hidden="true"></i>`；純圖示按鈕請加 `aria-label`）。若 Font Awesome 沒有合適圖示，或需要特殊視覺（如自繪 SVG 圖表／插圖、使用者明確想要 emoji），可彈性使用。
- **中英雙語切換（必備）**：頁首已內建中／英語言切換按鈕並提供 `ctx.I18n`。開發畫面時：
  1. `index.html` 的靜態文字請加上 `data-i18n-zh="..." data-i18n-en="..."`（輸入框提示用 `data-i18n-placeholder-zh`／`data-i18n-placeholder-en`；按鈕提示用 `data-i18n-title-zh`／`data-i18n-title-en`），`theme.js` 會在切換時自動替換。
  2. `app.js` 動態繪製的介面字串一律使用 `ctx.I18n.t('中文', 'English')`，並以 `ctx.I18n.onChange(function (lang) { render(); })` 監聽語言切換重繪畫面，不可自行實作第二套語言切換器。

**鎖定區（禁止修改、重寫、格式化，也不要「順手優化」）**
- `index.html` 在 `#appRoot` 以外的所有外框標籤
- `theme.js`、`base.css`：套用 DaisyUI 主題（深色／淺色與 20 套主題設定）、內建中／英語言切換（`ctx.I18n`）、共用排版與啟動流程（`theme.js` 負責依 `config.js` 載入模組與掛載應用{{if:local}}，並內建本機模式的 `ctx.Sync`{{if:local}}）。DaisyUI 5.0.0、Tailwind CSS 4.0.0 與 Font Awesome Free 7.3.1 皆由 CDN 載入並鎖定版本。
- `adapter.js`：與資料庫、登入服務溝通的底層（REST）
- `auth.js`：登入（Magic Link（邀請連結））
- `admin.js`：成員管理面板
- `sync.js`：資料層 `ctx.Sync`（隨選讀取（需要時重新整理））
- `rules.json`：資料庫安全規則（已部署到 Firebase；只改檔案不會生效）
- `config.js`：本專案的設定
- `AGENTS.md`：本檔
- `.gitignore`

需求無法只靠擴充區達成時：**停止**，回報使用者「哪個鎖定檔、為什麼需要改」，由使用者決定。

## 3. 絕對禁止（資安與架構鐵律）

- 不得修改鎖定區的任何檔案（或 `index.html` 在 `#appRoot` 以外的部分）。
- 不得把會變動的資料寫死在程式、HTML 或文件裡（內容、名單、設定值、金鑰…）。`index.html` 的 `#appRoot` 只能放靜態 UI 框架與空白容器，動態資料一律透過 `ctx.Sync` 存進資料庫。
- 不得在 `index.html` 內加 `<script>`、inline 事件屬性（`onclick=`、`onload=`…）或外部未鎖定資源；所有 JS 邏輯一律寫在 `app.js`。
- 不得在 `app.js` 直接呼叫資料庫 API、使用 Firebase SDK、自己實作登入，或繞過 `ctx`（`ctx` 沒有提供的能力，就是不該用）。
- 不得自行用 localStorage、IndexedDB、cookie 存業務資料。只有純 UI 偏好（如排序方式）可存 localStorage，key 必須以 `mws:onboarding-tracker-fy26:ui:` 開頭。
- 不得把名單、邀請連結、token、密碼、API 金鑰或 client secret 寫進任何檔案、commit 訊息或對話。
- 顯示資料庫內容時一律用 `textContent`（或等效的安全寫法），不得用 `innerHTML`、`outerHTML`、`insertAdjacentHTML` 插入資料。
- 不得引入 build 工具、框架或套件管理（npm、webpack、React…）。可以用 CDN 載入現成的函式庫，但必須鎖定完整版本號（例如 `@2.5.0`，不可用 `@latest`），並先告知使用者。
- 不得 commit `.local/` 與任何名單檔（已列在 `.gitignore`）。
- URL hash 的 `token` 參數保留給登入使用：不要拿 `#token` 做路由，也不要顯示或記錄邀請連結。
- 本機預覽連的是**正式資料庫**：不要塞測試資料，測試用的資料測完要刪掉。

## 4. `app.js` 契約

`window.App = { mount(root, ctx) }`：頁面準備好後呼叫一次；`root` 即 `#appRoot`，可直接用 `root.querySelector(...)` 取得你在 `index.html` `#appRoot` 內定義的元素，並只透過 `ctx` 取得資料與使用者。

- `ctx.session`：`{ uid, key, name, role, email }`；`role` 為 `admin`、`editor` 或 `viewer`。
- `ctx.canWrite`：是否顯示編輯功能。只是 UI 提示，真正的權限由資料庫規則強制。
- `ctx.cfg`：`config.js` 的內容（唯讀）。
- `ctx.I18n`：內建中英語言切換器：
  - `lang`：目前語言（`'zh'` 或 `'en'`）。
  - `t(zhText, enText)`：依目前語言回傳對應字串。
  - `apply(rootEl)`：掃描並套用 `data-i18n-zh`／`data-i18n-en` 等屬性。
  - `onChange(fn)`：註冊語言變更回呼（切換時請重新渲染動態列表）。
- `ctx.Sync`：資料層（`ctx.Sync.mode` = `on-demand`），見下。

`ctx.Sync` 的方法：
- `newId()`：產生新的記錄 id。
- `list(col)`：讀一次，回傳 `{ id: record }`。
- `save(col, id, rec)`：新增或「合併更新」單筆；欄位設為 `null` 代表刪除該欄位。
- `remove(col, id)`：刪除單筆。
- `subscribe(col, { onChange, onError, onStatus })`：回傳 `{ refresh(), stop() }`。
  - `onChange(map)`：資料載入後、遠端變更時、自己寫入成功後都會呼叫，`map` 是完整的 `{ id: record }`。它可能在任何時候到達，重繪時不要打斷使用者正在編輯的欄位。
  - `onStatus(s)`：`loading`、`live`、`offline`、`denied`、`auth`。連線狀態以它為主；`onError(err)` 只在載入或連線失敗時呼叫，暫時斷線不一定會觸發。
  - `err.kind`：`network`、`auth`、`denied`、`http`。
- 資料形狀：欄位值用字串、數字、布林；清單用「id → 物件」的 map，不要用陣列或空物件（資料庫會改變它們的形狀）。`col`、`id`、欄位名稱長度 1–128，且不可含 `. $ # [ ] /`。
- 這個專案不會自動收到別人的變更：需要最新資料時呼叫 `refresh()`（或重新整理頁面）。

## 5. 完成前檢查（逐項確認，全部通過才算完成）

1. `git status` 只出現 `index.html`、`app.js`、`app.css`（以及使用者明確要求的文件）；鎖定檔與 `index.html` 在 `#appRoot` 以外的外框沒有任何變動。
2. `index.html` 沒有新增 `<script>` 或 inline 事件（`onclick=` 等），也沒有寫死業務資料；`app.js` 內沒有 `fetch(`、`XMLHttpRequest`、`firebase`、`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`eval`，也沒有 localStorage（UI 偏好除外）。
3. 新增或修改的檔案裡沒有 `AIza`、`password`、`secret`、`token`、email 名單等敏感字樣或資料。
4. 本機預覽：在專案資料夾執行 `python -m http.server 8080`（或任何靜態伺服器），開啟 `http://localhost:8080`，確認畫面載入、功能正常、瀏覽器 Console 沒有錯誤。
   用不同角色檢查（可在「管理」面板建立測試成員，測完刪除）：`viewer` 看不到編輯功能；`admin`、`editor` 的新增、修改、刪除成功。
5. `git add -A`、`git commit`、`git push`；等 GitHub Pages 更新（約 1–2 分鐘），用 Ctrl+F5 強制重新整理，在線上版再測一次。

回報時請逐項附上檢查結果。任何一項不通過，修正後重來。

## 6. 部署、更新與救援

- 更新網站：改完並通過上面的檢查後 `git push`，GitHub Pages 會自動重新發佈。
- 鎖定檔或 `rules.json` 有問題、或需要改安全規則：不要自己改，回報使用者。由使用者用 `new-mini-web-service` skill 以相同參數重新執行 `provision.js`：它會覆蓋鎖定檔、重新部署規則，並保留 `index.html`、`app.js` 與 `app.css`。
- 資料庫在 Firebase Console → Realtime Database（專案 `onboarding-tracker-fy26`）：https://console.firebase.google.com/project/onboarding-tracker-fy26/database/onboarding-tracker-fy26-default-rtdb/data
- 成員名單在資料庫的 `/roster`。若管理員被鎖在外面，到 Console 直接編輯 `/roster`：把某位成員的 `role` 設為 `admin`、`active` 設為 `true`。
- 資料庫不保證自動備份；重要資料請定期到 Console 匯出 JSON。
