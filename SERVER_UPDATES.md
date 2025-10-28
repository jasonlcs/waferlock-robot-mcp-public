# 主 MCP Server 新功能更新 (v2.0.0)

## 日期: 2025-10-28

主 MCP Server (waferlock-robot-mcp) 已新增大量客服系統功能。此 CLI 可透過 REST API 存取所有新功能。

## 新增功能

### 1. MCP Resources (資源暴露)
透過 URI 直接存取結構化資料：

```typescript
// 存取特定手冊
waferlock://manuals/{manualId}

// 列出所有手冊
waferlock://manuals/all

// 存取 Q&A（依分類或 ID）
waferlock://qa/{categoryOrId}
waferlock://qa/all
```

**注意**: Resources 功能需要 MCP 客戶端支援（如 Claude Desktop），CLI 透過 REST API 間接提供。

### 2. MCP Prompts (客服流程模板)
5 個專業客服場景標準化流程：

- `troubleshoot_device` - 設備故障排查引導
- `installation_guide` - 安裝步驟助手  
- `maintenance_checklist` - 維護檢查清單生成
- `common_issues` - 常見問題快速回答
- `warranty_check` - 保固狀態查詢助手

### 3. 進階語意搜尋
- `semantic_search` - 跨所有手冊的 AI 語意搜尋
- 基於 OpenAI Embeddings
- 自動合併和排序結果
- 顯示相似度分數和來源手冊

### 4. 客服案例管理系統 (NEW!)
完整的案例追蹤系統：

**工具:**
- `create_case` - 建立新客服案例
- `get_case` - 查詢案例詳情
- `update_case` - 更新案例（狀態、優先級、備註）
- `search_cases` - 多條件搜尋案例
- `close_case` - 結案（自動計算解決時間）
- `get_case_statistics` - 統計報表

**資料追蹤:**
- 客戶資訊（ID, 姓名, email, 電話）
- 設備資訊（型號, 序號）
- 狀態管理（open → in_progress → resolved → closed）
- 優先級（low, medium, high, urgent）
- 時間軸事件記錄
- 關聯手冊和 Q&A
- 解決時間統計

## 對 CLI 用戶的影響

### ✅ 已支援功能
此 CLI 透過 REST API Proxy 可以使用：
- 所有現有的 Tools（手冊管理、Q&A、搜尋等）
- ✅ 新增的 semantic_search
- ✅ 新增的 case management tools

### ⚠️ 限制
以下功能需要直接連接 MCP Server（非透過 REST API）：
- MCP Resources（需客戶端支援 readResource）
- MCP Prompts（需客戶端支援 getPrompt）

### 建議使用方式

**場景 1: 遠端使用（推薦用此 CLI）**
```bash
npx --yes github:jasonlcs/waferlock-robot-mcp-public#v1.0.0 \
  --api-url https://your-heroku-app.herokuapp.com \
  --api-token YOUR_API_TOKEN
```

適合：
- 遠端團隊協作
- 不想暴露 AWS 憑證
- 使用 ChatGPT Desktop

**場景 2: 本地使用（完整功能）**
直接連接 MCP Server（參考主 repo README）

適合：
- Claude Desktop 用戶
- 需要使用 Resources 和 Prompts
- 本地開發測試

## API Endpoints 對照

| MCP Tool | REST API Endpoint | 支援狀態 |
|----------|------------------|---------|
| create_case | POST /api/cases | ✅ |
| get_case | GET /api/cases/{id} | ✅ |
| update_case | PUT /api/cases/{id} | ✅ |
| search_cases | GET /api/cases?... | ✅ |
| close_case | POST /api/cases/{id}/close | ✅ |
| get_case_statistics | GET /api/cases/statistics | ✅ |
| semantic_search | POST /api/search/semantic | ✅ |

**注意**: 確認主 Server 已部署 v2.0.0+ 才能使用新功能。

## 升級步驟

### 對 CLI 用戶
不需要升級 CLI，只需確認：
1. 主 MCP Server 已更新到 v2.0.0
2. API Token 有足夠權限（可能需要重新生成）

### 對主 Server 管理員
```bash
# 確保主 repo 已更新
cd waferlock-robot-mcp
git pull origin main

# 重新部署
npm run build
git push heroku main
```

## 更多資訊

詳細功能說明請參考主 repo:
- [TODO_MCP_IMPROVEMENTS.md](https://github.com/jasonlcs/waferlock-robot-mcp/blob/main/TODO_MCP_IMPROVEMENTS.md)
- [MCP_IMPROVEMENTS_SUMMARY.md](https://github.com/jasonlcs/waferlock-robot-mcp/blob/main/MCP_IMPROVEMENTS_SUMMARY.md)

## 版本對應

| CLI Version | 主 Server Version | 兼容性 |
|------------|------------------|--------|
| v1.0.0 | v1.x.x | ✅ 完全兼容 |
| v1.0.0 | v2.0.0+ | ✅ 完全兼容 + 新功能 |

---

**發布日期**: 2025-10-28  
**狀態**: Production Ready
