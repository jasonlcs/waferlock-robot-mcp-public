"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const vectorIndex_1 = require("../services/vectorIndex");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
/**
 * 啟動向量索引
 * POST /api/vector-index/start
 */
router.post('/start', auth_1.authenticateToken, async (req, res) => {
    try {
        const { fileId, fileName, forceRebuild = false } = req.body;
        if (!fileId || !fileName) {
            return res.status(400).json({
                error: 'fileId and fileName are required'
            });
        }
        const jobId = await vectorIndex_1.vectorIndexService.startIndexing(fileId, fileName, forceRebuild);
        res.json({
            success: true,
            jobId,
            message: forceRebuild ? 'Force rebuilding index...' : 'Indexing started'
        });
    }
    catch (error) {
        console.error('Start indexing error:', error);
        res.status(500).json({
            error: error.message || 'Failed to start indexing',
            details: error.message
        });
    }
});
/**
 * 查詢任務狀態
 * GET /api/vector-index/status/:jobId
 */
router.get('/status/:jobId', auth_1.authenticateToken, (req, res) => {
    try {
        const { jobId } = req.params;
        const job = vectorIndex_1.vectorIndexService.getJob(jobId);
        if (!job) {
            return res.status(404).json({
                error: 'Job not found'
            });
        }
        res.json({
            success: true,
            job
        });
    }
    catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({
            error: error.message || 'Failed to get job status'
        });
    }
});
/**
 * 列出所有任務
 * GET /api/vector-index/list
 */
router.get('/list', auth_1.authenticateToken, (req, res) => {
    try {
        const jobs = vectorIndex_1.vectorIndexService.listJobs();
        res.json({
            success: true,
            jobs,
            total: jobs.length
        });
    }
    catch (error) {
        console.error('List jobs error:', error);
        res.status(500).json({
            error: error.message || 'Failed to list jobs'
        });
    }
});
/**
 * 取消任務
 * POST /api/vector-index/cancel/:jobId
 */
router.post('/cancel/:jobId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { jobId } = req.params;
        const cancelled = await vectorIndex_1.vectorIndexService.cancelJob(jobId);
        if (!cancelled) {
            return res.status(400).json({
                error: 'Job cannot be cancelled (not found or already completed/failed)'
            });
        }
        res.json({
            success: true,
            message: 'Job cancelled'
        });
    }
    catch (error) {
        console.error('Cancel job error:', error);
        res.status(500).json({
            error: error.message || 'Failed to cancel job'
        });
    }
});
/**
 * 向量搜尋
 * POST /api/vector-index/search
 */
router.post('/search', auth_1.authenticateToken, async (req, res) => {
    try {
        const { fileId, query, k = 5, minScore = 0.0 } = req.body;
        if (!fileId) {
            return res.status(400).json({
                error: 'fileId is required'
            });
        }
        if (!query) {
            return res.status(400).json({
                error: 'query is required'
            });
        }
        // 執行向量搜尋
        const results = await vectorIndex_1.vectorIndexService.searchVector({
            fileId,
            query,
            k,
            minScore
        });
        res.json({
            success: true,
            results,
            total: results.length
        });
    }
    catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            error: error.message || 'Search failed'
        });
    }
});
/**
 * 健康檢查
 * GET /api/vector-index/health
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});
exports.default = router;
