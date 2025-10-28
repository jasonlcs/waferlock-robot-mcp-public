"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const types_1 = require("../types");
const fileContentStore_1 = require("../services/fileContentStore");
const contentExtractionService_1 = require("../services/contentExtractionService");
const qaService_1 = require("../services/qaService");
const router = express_1.Router();
/**
 * 搜尋特定手冊的內容
 * GET /api/search/manual/:fileId?query=...&limit=5
 */
router.get('/manual/:fileId', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), (req, res) => {
    try {
        const { fileId } = req.params;
        const { query, limit } = req.query;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query parameter is required' });
        }
        const fileContent = fileContentStore_1.fileContentStore.get(fileId);
        if (!fileContent) {
            return res.status(404).json({
                error: `Manual ${fileId} is not indexed yet. Please try again after upload completes.`,
            });
        }
        const limitNum = Math.min(parseInt(limit) || 5, 10);
        const results = contentExtractionService_1.contentExtractionService.searchChunks(fileContent.chunks, query, limitNum);
        res.json({
            fileId,
            query,
            resultCount: results.length,
            results: results.map(r => ({
                id: r.id,
                content: r.content,
                chunkOrder: r.chunkOrder,
            })),
        });
    }
    catch (error) {
        console.error('Manual content search error:', error);
        res.status(500).json({
            error: 'Search failed',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
/**
 * 搜尋所有手冊
 * GET /api/search/all-manuals?query=...&limit=10
 */
router.get('/all-manuals', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), (req, res) => {
    try {
        const { query, limit } = req.query;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query parameter is required' });
        }
        const results = fileContentStore_1.fileContentStore.searchAllChunks(query);
        const limitNum = Math.min(parseInt(limit) || 10, 20);
        const aggregated = [];
        for (const [fileId, chunks] of results) {
            for (const chunk of chunks.slice(0, 3)) {
                aggregated.push({
                    fileId,
                    content: chunk.content.substring(0, 300),
                    chunkOrder: chunk.chunkOrder,
                });
                if (aggregated.length >= limitNum)
                    break;
            }
            if (aggregated.length >= limitNum)
                break;
        }
        res.json({
            query,
            resultCount: aggregated.length,
            results: aggregated,
        });
    }
    catch (error) {
        console.error('Global search error:', error);
        res.status(500).json({
            error: 'Search failed',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
/**
 * 取得手冊索引統計
 * GET /api/search/manual/:fileId/stats
 */
router.get('/manual/:fileId/stats', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), (req, res) => {
    try {
        const { fileId } = req.params;
        const fileContent = fileContentStore_1.fileContentStore.get(fileId);
        // 從 chunks 計算總字符數
        const totalCharacters = fileContent
            ? fileContent.chunks.reduce((sum, c) => sum + c.content.length, 0)
            : 0;
        res.json({
            fileId,
            isIndexed: !!fileContent,
            ...(fileContent && {
                totalChunks: fileContent.totalChunks,
                totalCharacters,
                extractedAt: fileContent.extractedAt.toISOString(),
            }),
        });
    }
    catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});
/**
 * 智能搜尋 Q&A
 * GET /api/search/qa?query=...&limit=5&intelligent=true
 */
router.get('/qa', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.QaRead, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const { query, limit, intelligent } = req.query;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query parameter is required' });
        }
        const limitNum = Math.min(parseInt(limit) || 5, 10);
        const useIntelligent = intelligent !== 'false';
        let entries;
        if (useIntelligent) {
            entries = await qaService_1.qaService.intelligentSearch(query, limitNum);
        }
        else {
            entries = await qaService_1.qaService.searchEntries(query);
            entries = entries.slice(0, limitNum);
        }
        res.json({
            query,
            resultCount: entries.length,
            intelligent: useIntelligent,
            results: entries,
        });
    }
    catch (error) {
        console.error('QA search error:', error);
        res.status(500).json({
            error: 'Search failed',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
/**
 * 取得搜尋統計
 * GET /api/search/stats
 */
router.get('/stats', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), (req, res) => {
    try {
        res.json(fileContentStore_1.fileContentStore.getStats());
    }
    catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});
exports.default = router;
