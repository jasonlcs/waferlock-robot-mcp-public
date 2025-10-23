# Codex/Cursor 配置指南 - Waferlock MCP

## 🎯 終極目標

在 Codex/Cursor 中使用 Waferlock MCP，讓 AI 可以查詢你的 Waferlock 資料。

## 📋 前置要求

1. **Waferlock 服務器運行**
   ```
   主專案 (waferlock-robot-mcp) 在線
   例: https://waferlock-robot-mcp-1177c207c107.herokuapp.com/
   ```

2. **有效的 API 令牌**
   - 從服務器生成的令牌
   - 格式: `Bearer xxxxx...`

3. **Codex/Cursor 安裝**
   - Cursor IDE 或 VS Code + Codex 擴展

## 🔧 配置步驟

### Step 1: 定位配置文件

```bash
# macOS / Linux
~/.config/Cursor/config.toml
# 或
~/.config/Code/User/settings.json (VS Code)

# Windows
%APPDATA%\Cursor\config.toml
# 或
%APPDATA%\Code\User\settings.json
```

### Step 2: 添加 MCP 服務器配置

編輯 `config.toml` 或對應的配置文件，添加以下內容：

#### 方案 A：使用 GitHub repo（推薦）

```toml
[mcp_servers.waferlock-robot]
command = "npx"
args = [
  "--yes",
  "github:jasonlcs/waferlock-robot-mcp-public",
  "--api-url",
  "https://waferlock-robot-mcp-1177c207c107.herokuapp.com/",
  "--api-token",
  "your-api-token-here"
]
```

**說明**:
- `npx --yes` - 自動下載並運行包
- `github:jasonlcs/waferlock-robot-mcp-public` - GitHub repo
- `--api-url` - 你的 Waferlock 服務器 URL
- `--api-token` - API 令牌（從服務器獲取）

#### 方案 B：本地測試（開發用）

```toml
[mcp_servers.waferlock-robot]
command = "node"
args = [
  "/path/to/waferlock-robot-mcp-public/dist/cli.js",
  "--api-url",
  "http://localhost:3000/",
  "--api-token",
  "your-api-token-here"
]
```

#### 方案 C：使用 npm 包（如果發布到 npm）

```toml
[mcp_servers.waferlock-robot]
command = "npx"
args = [
  "waferlock-robot-mcp",
  "--api-url",
  "https://your-server.com/",
  "--api-token",
  "your-token"
]
```

### Step 3: 驗證配置

重啟 Codex/Cursor 後，檢查：

1. 打開命令面板
   - Codex: `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux)
   - 輸入 "MCP" 搜尋相關命令

2. 查看 MCP 連接狀態
   - 應該顯示 "waferlock-robot" 已連接

3. 測試查詢
   - 問 AI：「Waferlock 怎麼安裝？」
   - 應該通過 MCP 工具返回答案

## 📝 完整配置示例

```toml
# Cursor config.toml

[mcp_servers.waferlock-robot]
command = "npx"
args = [
  "--yes",
  "github:jasonlcs/waferlock-robot-mcp-public",
  "--api-url",
  "https://waferlock-robot-mcp-1177c207c107.herokuapp.com/",
  "--api-token",
  "sk_test_1234567890abcdef"
]

# 可選：添加環境變數
env = { NODE_ENV = "production" }

# 可選：自定義 MCP 伺服器名稱
# 其他配置...
```

## 🧪 測試連接

### 本地測試

```bash
# 1. 確保主專案運行
cd waferlock-robot-mcp
npm run dev

# 2. 在另一個終端，測試 public repo CLI
cd waferlock-robot-mcp-public
node dist/cli.js \
  --api-url http://localhost:3000 \
  --api-token test-token
```

### 檢查日誌

```bash
# Cursor 日誌位置
# macOS
~/Library/Logs/Cursor/
# Linux
~/.cache/Cursor/logs/
# Windows
%APPDATA%\Cursor\logs\
```

## 🔐 安全最佳實踐

### 1. 令牌管理

```bash
# ❌ 不要這樣做（暴露令牌）
args = ["--api-url", "...", "--api-token", "sk_test_abc123"]

# ✅ 應該這樣做（使用環境變數）
env = { WAFERLOCK_API_TOKEN = "${WAFERLOCK_API_TOKEN}" }
# 然後在 Shell 中設定:
# export WAFERLOCK_API_TOKEN="sk_test_abc123"
```

### 2. 使用長期令牌

- 生成具有最小權限的 API 令牌
- 定期輪換令牌
- 避免在版本控制中提交令牌

### 3. HTTPS 連接

```toml
# ✅ 正確
--api-url "https://your-secure-server.com/"

# ❌ 避免
--api-url "http://insecure-server.com/"
```

## 🐛 故障排查

### 問題 1：MCP 伺服器連接失敗

**症狀**: Codex 無法連接到 MCP 伺服器

**解決方案**:
```bash
# 1. 檢查 URL 是否正確
# 2. 檢查令牌是否有效
# 3. 檢查服務器是否在線

# 測試連接
curl -H "Authorization: Bearer your-token" \
  https://your-server.com/api/health
```

### 問題 2：找不到命令

**症狀**: `npx` 無法找到 package

**解決方案**:
```bash
# 清除 npm 快取
npm cache clean --force

# 重試
npx --yes github:jasonlcs/waferlock-robot-mcp-public --help
```

### 問題 3：編譯錯誤

**症狀**: dist/cli.js 不存在或損壞

**解決方案**:
```bash
# 重新編譯
cd waferlock-robot-mcp-public
npm install
npm run build

# 驗證
node dist/cli.js --help
```

### 問題 4：API 調用失敗

**症狀**: MCP 工具無法查詢資料

**解決方案**:
```bash
# 檢查 API 端點是否可用
curl -H "Authorization: Bearer your-token" \
  "https://your-server.com/api/search/qa?query=test"

# 檢查令牌權限
# 應該有 FILES_READ 和 QA_READ 權限
```

## 📊 支援的 MCP 工具

一旦連接成功，以下工具可用：

### Q&A 工具
- `list_qa_entries` - 列出所有 Q&A
- `search_qa_entries` - 搜尋 Q&A（智能排序）
- `get_qa_entry` - 取得特定 Q&A

### 手冊工具
- `list_manuals` - 列出所有手冊
- `get_manual_download_url` - 取得下載 URL
- `get_manual_content` - 取得手冊內容
- `search_manual_content` - 搜尋手冊內容 ✨ 新增
- `search_all_manuals` - 跨手冊搜尋 ✨ 新增
- `get_manual_index_stats` - 取得索引統計 ✨ 新增

## 🚀 使用示例

在 Codex/Cursor 中：

```
用戶: "Waferlock 怎麼安裝？"

Cursor 會自動：
1. 調用 search_qa_entries("安裝")
2. 取得相關 Q&A
3. 返回答案給用戶

用戶: "手冊中有哪些故障排查方法？"

Cursor 會：
1. 調用 search_manual_content(query="故障排查")
2. 搜尋所有手冊
3. 返回相關段落
```

## 📞 支援

遇到問題？

1. 檢查日誌文件（見上方 "檢查日誌"）
2. 測試 API 連接（見上方 "測試連接"）
3. 查看 [SYNC_UPDATE.md](SYNC_UPDATE.md) 中的同步說明
4. 參考主專案的文檔

## ✅ 檢查清單

在使用前，確認以下項目：

- [ ] Waferlock 服務器在線
- [ ] 有有效的 API 令牌
- [ ] config.toml 已正確配置
- [ ] Codex/Cursor 已重啟
- [ ] `npx github:jasonlcs/waferlock-robot-mcp-public --help` 成功運行
- [ ] MCP 伺服器在 Codex 中顯示為已連接

---

**版本**: 1.0.0
**最後更新**: 2025-10-23
**狀態**: ✅ 準備就緒
