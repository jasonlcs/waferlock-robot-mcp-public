"use strict";
/**
 * Legacy Content Extraction Service (已棄用)
 *
 * 此服務已移除 pdf-parse 依賴
 * 未來將由 AWS Lambda + 向量索引取代
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentExtractionService = exports.ContentExtractionService = void 0;
class ContentExtractionService {
    /**
     * 已棄用：不再提取 PDF 文字
     * 改由 Lambda 處理
     */
    async processFile(filePath, fileId, fileName) {
        throw new Error('ContentExtractionService is deprecated. Use Lambda indexing instead.');
    }
    /**
     * 已棄用：簡易關鍵字搜尋
     */
    searchChunks(chunks, query, limit = 5) {
        const queryLower = query.toLowerCase();
        const scored = chunks
            .map((chunk) => {
            const contentLower = chunk.content.toLowerCase();
            const matchCount = (contentLower.match(new RegExp(queryLower, 'g')) || []).length;
            return { chunk, score: matchCount };
        })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map((item) => item.chunk);
    }
}
exports.ContentExtractionService = ContentExtractionService;
exports.contentExtractionService = new ContentExtractionService();
