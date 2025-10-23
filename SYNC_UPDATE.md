# Public Repo 同步更新說明

## 📋 同步日期
2025-10-23

## 🔄 同步內容

### P0 - 新增文檔（已同步）

#### 1. docs/CHATGPT_SYSTEM_PROMPT.md
- **內容**: ChatGPT 整合的 System Prompt 範本
- **版本**: 完整版
- **包含**:
  - 基礎 System Prompt
  - 進階版本（上下文學習）
  - 技術支援專用版本
  - 售前/售後顧問版本
  - 4 個測試用例

#### 2. docs/CHATGPT_CUSTOMER_SERVICE_GUIDE.md
- **內容**: 完整的實施和運營指南
- **版本**: 完整版
- **包含**:
  - 快速開始（3 步）
  - API 端點參考
  - 工作流程圖解
  - 性能考量和限制
  - 故障排查指南
  - 最佳實踐
  - 下一步建議

### P1 - MCP 工具改進（主專案已完成，Public Repo 待實現）

主專案 `src/services/mcpService.ts` 已新增以下功能：

#### 新增的 3 個搜尋工具
1. **search_manual_content**
   - 在特定手冊中搜尋相關內容
   - 返回相關段落（不是整個檔案）
   - 支持 limit 參數

2. **search_all_manuals**
   - 跨所有手冊搜尋
   - 聚合結果
   - 按相關性排序

3. **get_manual_index_stats**
   - 檢查手冊是否已索引
   - 返回統計信息

#### 改進的工具
- **search_qa_entries** - 現在使用智能相關性排序

### ⚠️ 重要提示：Public Repo 與主專案的區別

**Public Repo** (`waferlock-robot-mcp-public`)
- 用途: 獨立的 MCP CLI
- 用戶: 終端用戶（通過 Cursor/ChatGPT）
- 連接: 通過 API 連接到服務器
- 特性: 輕量級，只包含 MCP 客戶端

**主專案** (`waferlock-robot-mcp`)
- 用途: 完整服務器 + MCP 實現
- 用戶: 內部開發/部署
- 特性: 包含所有功能（S3、搜尋、索引等）

---

## 🚀 Public Repo 的後續步驟

### 1. 將新工具 API 化（推薦）

如果要在 public repo 中使用新的搜尋功能，需要：

```typescript
// 在 public repo 中，應該通過 API 呼叫
// 而不是本地實現

async function searchManualContent(fileId: string, query: string) {
  const response = await fetch(
    `${apiUrl}/api/search/manual/${fileId}?query=${query}`,
    {
      headers: { Authorization: `Bearer ${apiToken}` }
    }
  );
  return response.json();
}
```

### 2. 擴展 manualApiProvider（可選）

在 `src/services/manualApiProvider.ts` 中新增：

```typescript
// 新增搜尋方法
async function searchManualContent(
  fileId: string,
  query: string,
  limit: number = 5
): Promise<SearchResult[]> {
  // 調用服務器 API
}
```

### 3. 更新 mcpService.ts（推薦）

整合新的搜尋工具：

```typescript
// search_manual_content 工具應該：
// 1. 接收 fileId 和 query
// 2. 通過 API Provider 調用服務器
// 3. 返回結果給 ChatGPT/Cursor
```

---

## 📊 同步檢查清單

### 已完成 ✅
- [x] 複製 docs/CHATGPT_SYSTEM_PROMPT.md
- [x] 複製 docs/CHATGPT_CUSTOMER_SERVICE_GUIDE.md
- [x] 記錄同步內容

### 待完成 🔲
- [ ] 實現 search_manual_content MCP 工具
- [ ] 實現 search_all_manuals MCP 工具
- [ ] 實現 get_manual_index_stats MCP 工具
- [ ] 測試編譯

### 可選 📝
- [ ] 更新 README.md
- [ ] 新增 CHANGELOG 條目
- [ ] 發布新版本

---

## 🔗 相關文件

### 主專案
- `waferlock-robot-mcp/src/services/mcpService.ts` - 改進版本
- `waferlock-robot-mcp/src/services/contentExtractionService.ts` - PDF 提取
- `waferlock-robot-mcp/src/services/fileContentStore.ts` - 內容儲存
- `waferlock-robot-mcp/src/routes/search.ts` - REST API 端點

### Public Repo
- `waferlock-robot-mcp-public/docs/CHATGPT_SYSTEM_PROMPT.md` - ✅ 已同步
- `waferlock-robot-mcp-public/docs/CHATGPT_CUSTOMER_SERVICE_GUIDE.md` - ✅ 已同步

---

## 📝 版本管理建議

**主專案**: v1.0.0（已完成）
**Public Repo**: v1.0.0 → v1.1.0（推薦）

更新 public repo 的 package.json：

```json
{
  "version": "1.1.0",
  "description": "Standalone Waferlock MCP CLI with enhanced search capabilities"
}
```

---

## 🎯 下一次行動

當準備在 public repo 中實現新的搜尋工具時，可以：

1. 選擇 API 整合方式
2. 擴展 manualApiProvider/qaApiProvider
3. 更新 mcpService.ts 以使用新工具
4. 測試編譯和功能
5. 更新版本和發布

---

**同步完成日期**: 2025-10-23
**同步狀態**: ✅ 文檔已同步，MCP 工具待評估
