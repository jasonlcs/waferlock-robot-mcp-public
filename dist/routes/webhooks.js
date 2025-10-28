"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const s3Service_1 = require("../services/s3Service");
const server_1 = require("../server");
const router = express_1.Router();
/**
 * Webhook: 接收 Lambda 索引完成通知 (透過 SNS)
 */
router.post('/indexing-complete', async (req, res) => {
    try {
        console.log('Received indexing completion webhook:', JSON.stringify(req.body, null, 2));
        // SNS 會將訊息包裝在 Message 欄位中
        let payload;
        if (req.body.Type === 'Notification' && req.body.Message) {
            // 來自 SNS
            payload = JSON.parse(req.body.Message);
        }
        else {
            // 直接呼叫 (測試用)
            payload = req.body;
        }
        const { fileId, fileName, manifest } = payload;
        if (!fileId || !fileName || !manifest) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        console.log(`Indexing completed for ${fileName} (${fileId})`);
        console.log(`  - Chunks: ${manifest.chunksCount}`);
        console.log(`  - Embeddings: ${manifest.embeddingsCount}`);
        console.log(`  - Tokens used: ${manifest.totalTokensUsed}`);
        console.log(`  - Estimated cost: $${manifest.estimatedCost.toFixed(4)}`);
        console.log(`  - Processing time: ${manifest.processingTimeMs}ms`);
        // 更新檔案 metadata
        try {
            const file = await s3Service_1.s3Service.getFileById(fileId);
            if (file) {
                file.indexed = true;
                file.indexManifest = manifest;
                await s3Service_1.s3Service.updateFileMetadata(fileId, file);
                console.log(`Updated file metadata for ${fileId}`);
            }
        }
        catch (metadataError) {
            console.error('Failed to update file metadata:', metadataError);
            // 不拋出錯誤，因為索引已完成
        }
        // 發送 WebSocket 通知給前端
        try {
            const io = server_1.getIO();
            io.emit('indexing:complete', {
                fileId,
                fileName,
                manifest,
            });
            console.log('WebSocket notification sent');
        }
        catch (wsError) {
            console.error('Failed to send WebSocket notification:', wsError);
        }
        res.json({
            success: true,
            message: 'Indexing completion processed',
        });
    }
    catch (error) {
        console.error('Failed to process indexing completion:', error);
        res.status(500).json({
            error: 'Failed to process webhook',
            details: error.message,
        });
    }
});
/**
 * Webhook: 接收 Lambda 索引失敗通知
 */
router.post('/indexing-error', async (req, res) => {
    try {
        console.log('Received indexing error webhook:', JSON.stringify(req.body, null, 2));
        let payload;
        if (req.body.Type === 'Notification' && req.body.Message) {
            payload = JSON.parse(req.body.Message);
        }
        else {
            payload = req.body;
        }
        const { fileId, fileName, error, processingTimeMs } = payload;
        if (!fileId || !fileName) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        console.error(`Indexing failed for ${fileName} (${fileId}): ${error}`);
        console.error(`  Processing time: ${processingTimeMs}ms`);
        // 更新檔案狀態為失敗
        try {
            const file = await s3Service_1.s3Service.getFileById(fileId);
            if (file) {
                file.indexed = false;
                file.indexError = error;
                await s3Service_1.s3Service.updateFileMetadata(fileId, file);
            }
        }
        catch (metadataError) {
            console.error('Failed to update file metadata:', metadataError);
        }
        // 發送 WebSocket 通知
        try {
            const io = server_1.getIO();
            io.emit('indexing:error', {
                fileId,
                fileName,
                error,
                processingTimeMs,
            });
        }
        catch (wsError) {
            console.error('Failed to send WebSocket notification:', wsError);
        }
        res.json({
            success: true,
            message: 'Error notification processed',
        });
    }
    catch (error) {
        console.error('Failed to process error webhook:', error);
        res.status(500).json({
            error: 'Failed to process webhook',
            details: error.message,
        });
    }
});
/**
 * SNS 訂閱確認 (SNS 第一次訂閱時會發送確認請求)
 */
router.post('/sns-subscription', async (req, res) => {
    try {
        if (req.body.Type === 'SubscriptionConfirmation') {
            const subscribeURL = req.body.SubscribeURL;
            console.log('SNS subscription confirmation received');
            console.log('Please confirm by visiting:', subscribeURL);
            // 自動確認 (生產環境可能需要手動確認)
            const https = require('https');
            https.get(subscribeURL, (response) => {
                console.log('SNS subscription confirmed');
            });
            return res.json({
                success: true,
                message: 'Subscription confirmation in progress',
            });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Failed to process SNS subscription:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * 健康檢查端點
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});
exports.default = router;
