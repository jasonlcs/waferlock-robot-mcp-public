# Waferlock MCP CLI (Public)

這個專案提供一個獨立的 CLI，透過 Waferlock Robot MCP 在 Heroku 上的公開 REST API，將資料橋接到支援 Model Context Protocol (MCP) 的客戶端（例如 ChatGPT Desktop）。使用者只需要 API URL 與 Token，即可在本地啟動 stdio 版 MCP 伺服器，不需暴露 AWS 憑證。

## 安裝與使用

### 1. 取得程式碼

```bash
git clone https://github.com/jasonlcs/waferlock-robot-mcp-public.git
cd waferlock-robot-mcp-public
```

### 2. 編譯

```bash
npm install
npm run build
```

### 3. 直接執行 (本地調試)

```bash
node dist/cli.js \
  --api-url https://waferlock-robot-mcp-1177c207c107.herokuapp.com \
  --api-token <你的 API Token> \
  --mcp-token <選填：要求 MCP 客戶端提供的 Token>
```

- `--server-name`：覆寫 MCP server 名稱
- `--server-version`：覆寫 MCP server 版本
- `--mcp-token`：若指定，MCP 客戶端必須提供同樣的 Token（透過環境變數或連線設定）

### 4. 透過 `npx` 執行 (Git 來源)

建立 tag 後（例如 `git tag v1.0.0 && git push origin v1.0.0`），即可提供使用者以下指令：

```bash
npx --yes github:jasonlcs/waferlock-robot-mcp-public#v1.0.0 \
  --api-url https://waferlock-robot-mcp-1177c207c107.herokuapp.com \
  --api-token <你的 API Token> \
  --mcp-token <選填>
```

### 5. ChatGPT Desktop 設定範例

```json
{
  "mcpServers": {
    "waferlock-robot": {
      "command": "npx",
      "args": [
        "--yes",
        "github:jasonlcs/waferlock-robot-mcp-public#v1.0.0",
        "--api-url", "https://waferlock-robot-mcp-1177c207c107.herokuapp.com",
        "--api-token", "<你的 API Token>",
        "--mcp-token", "<選填>"
      ]
    }
  }
}
```

將 `jasonlcs`、`waferlock-robot-mcp-1177c207c107`、`<你的 API Token>` 改成實際值即可使用。

## 專案結構

```
waferlock-robot-mcp-public/
├── package.json
├── tsconfig.json
├── README.md
└── src
    ├── cli.ts
    └── services
        ├── manualApiProvider.ts
        ├── manualProvider.ts
        └── mcpService.ts
```

## 開發注意事項
- 需要 Node.js 18+（提供原生 `fetch`）。
- CLI 會優先讀取命令列參數（`--api-url`、`--api-token` 等），若未提供則回退至環境變數 `API_URL`、`API_TOKEN`、`MCP_TOKEN`。
- 內建 `dotenv`，會載入 `.env`（選用）。
- 專案使用 TypeScript；若想讓使用者省去編譯步驟，可在 repo 中同步 `dist/`，或加上 npm `prepare` 腳本在安裝時自動編譯。

## 後續步驟
1. `npm run build` 確認 `dist/` 生成。必要時 `chmod +x dist/cli.js`。
2. `git add . && git commit -m "Initial public CLI"`，再 `git push -u origin main`。
3. 建立版本 tag（例：`git tag v1.0.0 && git push origin v1.0.0`）。
4. 在主專案或文件提到此 CLI，指引用法（`npx github:...` 或 `node dist/cli.js ...`）。

## 授權
ISC License
