"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const s3Service_1 = require("../services/s3Service");
const vectorIndex_1 = require("../services/vectorIndex");
const server_1 = require("../server");
const router = express_1.Router();
/**
 * POST /api/indexing-callback
 * Lambda 完成索引建立後的回調 endpoint
 */
router.post('/indexing-callback', async (req, res) => {
    try {
        const payload = req.body;
        console.log(`Received indexing callback for ${payload.fileName} (${payload.fileId}): ${payload.status}`);
        if (!payload.fileId || !payload.fileName || !payload.status) {
            return res.status(400).json({
                error: 'Invalid callback payload',
                required: ['fileId', 'fileName', 'status']
            });
        }
        // 更新 VectorIndexService 的 job 狀態（如果有 jobId）
        if (payload.jobId) {
            await vectorIndex_1.vectorIndexService.updateJobFromCallback(payload.jobId, payload.status === 'completed', payload.error, {
                processingTime: payload.processingTime,
                stats: payload.stats,
                numChunks: payload.numChunks,
                numVectors: payload.numVectors
            });
        }
        // 更新檔案 metadata
        if (payload.status === 'completed') {
            await s3Service_1.s3Service.updateFileMetadata(payload.fileId, {
                indexStatus: 'completed',
                indexCompletedAt: new Date().toISOString(),
                indexKey: payload.indexKey,
                metadataKey: payload.metadataKey,
                numChunks: payload.numChunks,
                numVectors: payload.numVectors
            });
            console.log(`✓ Indexing completed for ${payload.fileName}`);
            console.log(`  - Index: ${payload.indexKey}`);
            console.log(`  - Chunks: ${payload.numChunks}, Vectors: ${payload.numVectors}`);
            // 發送 WebSocket 通知前端
            try {
                const io = server_1.getIO();
                io.emit('indexing:completed', {
                    fileId: payload.fileId,
                    fileName: payload.fileName,
                    jobId: payload.jobId,
                    numChunks: payload.numChunks,
                    numVectors: payload.numVectors
                });
            }
            catch (wsError) {
                console.error('Failed to send WebSocket notification:', wsError);
            }
        }
        else {
            await s3Service_1.s3Service.updateFileMetadata(payload.fileId, {
                indexStatus: 'failed',
                indexError: payload.error || 'Unknown error'
            });
            console.log(`✗ Indexing failed for ${payload.fileName}: ${payload.error}`);
            // 發送 WebSocket 通知前端
            try {
                const io = server_1.getIO();
                io.emit('indexing:failed', {
                    fileId: payload.fileId,
                    fileName: payload.fileName,
                    jobId: payload.jobId,
                    error: payload.error
                });
            }
            catch (wsError) {
                console.error('Failed to send WebSocket notification:', wsError);
            }
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Indexing callback error:', error);
        res.status(500).json({
            error: 'Failed to process callback',
            details: error.message
        });
    }
});
exports.default = router;
