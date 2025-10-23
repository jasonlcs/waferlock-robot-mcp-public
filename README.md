# Waferlock MCP CLI (Public)

這個專案提供一個獨立的 CLI，透過 Waferlock Robot MCP 的公開 REST API，將資料橋接到支援 Model Context Protocol (MCP) 的客戶端（例如 ChatGPT Desktop）。使用者只需要 API URL 與 Token，即可在本地啟動 stdio 版 MCP 伺服器，不需暴露 AWS 憑證。

## 安裝與使用

### 1. 編譯

```
npm install
npm run build
```

### 2. 直接執行

```
node dist/cli.js --api-url https://your-app.herokuapp.com --api-token YOUR_API_TOKEN
```

可選參數：
- `--server-name`：覆寫 MCP server 名稱
- `--server-version`：覆寫版本
- `--mcp-token`：要求客戶端連線時提供此 Token

### 3. 透過 `npx` 執行 (Git 來源)

對外公開此 repo 後，可使用：

```
npx --yes github:<your-account>/waferlock-robot-mcp-public#v1.0.0 \
  --api-url https://your-app.herokuapp.com \
  --api-token YOUR_API_TOKEN \
  --mcp-token OPTIONAL_MCP_TOKEN
```

### 4. ChatGPT Desktop 設定範例

```json
{
  "mcpServers": {
    "waferlock-robot": {
      "command": "npx",
      "args": [
        "--yes",
        "github:<your-account>/waferlock-robot-mcp-public#v1.0.0",
        "--api-url", "https://your-app.herokuapp.com",
        "--api-token", "YOUR_API_TOKEN",
        "--mcp-token", "OPTIONAL_MCP_TOKEN"
      ]
    }
  }
}
```

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
- Node.js 18+ (提供原生 `fetch`)。
- `dotenv` 會載入 `.env`，但 CLI 同時支援命令列參數與環境變數。
- 專案使用 TypeScript，發佈時可將 `dist/` 連同 JS 一併 commit，或保留 `prepare` 腳本在安裝時自動編譯。

## 授權
ISC License
