"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const s3Service_1 = require("../services/s3Service");
const auth_1 = require("../middleware/auth");
const types_1 = require("../types");
const lambdaIndexer_1 = require("../services/lambdaIndexer");
const vectorIndex_1 = require("../services/vectorIndex");
const router = express_1.Router();
// 設置檔案大小限制（100 MB）
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
// 使用磁碟暫存而非記憶體，避免大檔案爆記憶體
const uploadDir = path.join(process.cwd(), 'data', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer_1.default({
    storage: multer_1.default.diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, uniqueSuffix + '-' + file.originalname);
        }
    }),
    limits: {
        fileSize: MAX_FILE_SIZE
    }
});
function parseExpiresInSeconds(value) {
    if (value === undefined) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return undefined;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return Math.min(Math.floor(parsed), 60 * 60); // cap at 1 hour
}
// Upload a file to S3
router.post('/upload', auth_1.authenticateToken, auth_1.requireAllScopes(types_1.TokenScope.FilesWrite), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        // 檢查檔案大小
        const fileSizeMB = req.file.size / (1024 * 1024);
        if (req.file.size > MAX_FILE_SIZE) {
            return res.status(413).json({
                error: '檔案過大',
                details: `檔案大小 ${fileSizeMB.toFixed(2)} MB，超過限制 100 MB`,
                hint: '請上傳較小的檔案'
            });
        }
        console.log(`Uploading file: ${req.file.originalname} (${fileSizeMB.toFixed(2)} MB)`);
        // 檢查 PDF 密碼
        const pdfPassword = req.body.pdfPassword || req.query.pdfPassword;
        const uploadedFile = await s3Service_1.s3Service.uploadFile(req.file, { pdfPassword });
        // 清理暫存檔案
        if (req.file.path) {
            fs.unlinkSync(req.file.path);
        }
        // 自動觸發向量索引 (使用 Lambda，如果啟用且為 PDF 檔案)
        const shouldAutoIndex = process.env.AUTO_INDEX_PDF === 'true';
        let indexingTriggered = false;
        if (shouldAutoIndex && uploadedFile.originalName.toLowerCase().endsWith('.pdf')) {
            console.log(`Auto-triggering Lambda indexing for ${uploadedFile.originalName}`);
            try {
                indexingTriggered = await lambdaIndexer_1.lambdaIndexerService.triggerIndexing(uploadedFile.id, uploadedFile.originalName, uploadedFile.s3Key);
                console.log(`Lambda indexing triggered: ${indexingTriggered}`);
            }
            catch (error) {
                console.error(`Failed to trigger Lambda indexing: ${error.message}`);
            }
        }
        res.json({
            success: true,
            file: uploadedFile,
            indexingTriggered,
            indexingMethod: indexingTriggered ? 'lambda' : 'none'
        });
    }
    catch (error) {
        console.error('Upload error:', error);
        // 清理暫存檔案
        if (req.file?.path) {
            try {
                fs.unlinkSync(req.file.path);
            }
            catch (cleanupError) {
                console.error('Failed to cleanup temp file:', cleanupError);
            }
        }
        // 檢查 multer 檔案大小錯誤
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: '檔案過大',
                details: `檔案超過 ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)} MB 限制`,
                hint: '請上傳較小的檔案'
            });
        }
        // 檢查 PDF 密碼相關錯誤
        if (error.message && error.message.includes('PDF password required')) {
            return res.status(400).json({
                error: 'PDF 密碼必須',
                details: '此 PDF 檔案受密碼保護，請提供正確的密碼',
                hint: '在上傳時加入 pdfPassword 參數'
            });
        }
        if (error.message && error.message.includes('Invalid PDF password')) {
            return res.status(400).json({
                error: 'PDF 密碼錯誤',
                details: '提供的 PDF 密碼不正確',
                hint: '請提供正確的密碼後重新上傳'
            });
        }
        // Check for specific AWS error types and provide Chinese translations
        const errorMessage = error.message || 'Unknown error occurred';
        if (errorMessage.includes('AWS_ACCESS_KEY_ID')) {
            return res.status(500).json({
                error: 'AWS Access Key 未設定或無效',
                details: errorMessage,
                hint: '請檢查 .env 檔案中的 AWS_ACCESS_KEY_ID 設定'
            });
        }
        if (errorMessage.includes('AWS_SECRET_ACCESS_KEY')) {
            return res.status(500).json({
                error: 'AWS Secret Key 未設定或無效',
                details: errorMessage,
                hint: '請檢查 .env 檔案中的 AWS_SECRET_ACCESS_KEY 設定'
            });
        }
        if (errorMessage.includes('credentials format')) {
            return res.status(500).json({
                error: 'AWS 憑證格式錯誤',
                details: errorMessage,
                hint: '請確認憑證沒有多餘空格，且 Access Key 格式正確（通常以 AKIA 開頭）'
            });
        }
        if (errorMessage.includes('NoSuchBucket') || errorMessage.includes('does not exist')) {
            return res.status(500).json({
                error: 'S3 Bucket 不存在',
                details: errorMessage,
                hint: '請確認 S3_BUCKET_NAME 在 .env 中設定正確，且 Bucket 已建立'
            });
        }
        // Generic error with helpful details
        res.status(500).json({
            error: '檔案上傳失敗',
            details: errorMessage,
            hint: '請檢查 AWS 憑證、區域和 Bucket 設定是否正確'
        });
    }
});
// List all uploaded files
router.get('/list', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const files = await s3Service_1.s3Service.listFiles();
        res.json({ files });
    }
    catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ error: 'Failed to list files' });
    }
});
// Get file info by ID
router.get('/:fileId', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const { fileId } = req.params;
        const file = await s3Service_1.s3Service.getFileById(fileId);
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.json({ file });
    }
    catch (error) {
        console.error('Get file error:', error);
        res.status(500).json({ error: 'Failed to get file' });
    }
});
// Generate a temporary download URL for a file
router.get('/:fileId/download-url', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const { fileId } = req.params;
        const requestedExpires = parseExpiresInSeconds(req.query.expiresInSeconds);
        const downloadUrl = await s3Service_1.s3Service.generateDownloadUrl(fileId, {
            expiresInSeconds: requestedExpires,
        });
        if (!downloadUrl) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.json({
            downloadUrl,
            expiresInSeconds: requestedExpires ?? 900,
        });
    }
    catch (error) {
        console.error('Generate download URL error:', error);
        if (error?.message?.includes('AWS credentials')) {
            return res.status(500).json({
                error: 'Unable to generate download URL',
                details: 'AWS credentials are not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
            });
        }
        res.status(500).json({ error: 'Failed to generate download URL' });
    }
});
// Fetch file content as base64 (for trusted AI workflows)
router.get('/:fileId/content', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const { fileId } = req.params;
        const result = await s3Service_1.s3Service.downloadFileBuffer(fileId);
        if (!result) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.json({
            file: result.file,
            contentBase64: result.buffer.toString('base64'),
        });
    }
    catch (error) {
        console.error('Fetch manual content error:', error);
        if (error?.message?.includes('AWS credentials')) {
            return res.status(500).json({
                error: 'Unable to fetch manual content',
                details: 'AWS credentials are not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
            });
        }
        res.status(500).json({ error: 'Failed to fetch manual content' });
    }
});
// Delete file by ID
router.delete('/:fileId', auth_1.authenticateToken, auth_1.requireAllScopes(types_1.TokenScope.FilesWrite), async (req, res) => {
    try {
        const { fileId } = req.params;
        const deleted = await s3Service_1.s3Service.deleteFile(fileId);
        if (!deleted) {
            return res.status(404).json({
                error: 'File not found',
                hint: '檔案 ID 不存在或已被刪除'
            });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete file error:', error);
        let details;
        let hint;
        if (error?.message) {
            details = error.message;
        }
        // 檢查 AWS 相關錯誤
        if (error?.Code === 'NoSuchBucket') {
            hint = 'S3 Bucket 不存在，檢查 S3_BUCKET_NAME 配置';
        }
        else if (error?.Code === 'AccessDenied') {
            hint = 'AWS 認證失敗或無刪除權限，檢查 IAM 角色';
        }
        else if (error?.Code === 'InvalidAccessKeyId' || error?.Code === 'SignatureDoesNotMatch') {
            hint = 'AWS 認證錯誤，檢查 Access Key 和 Secret Key';
        }
        res.status(500).json({
            error: 'Failed to delete file',
            details,
            hint
        });
    }
});
// Get PDF password for a file
router.get('/:fileId/password', auth_1.authenticateToken, auth_1.requireAllScopes(types_1.TokenScope.FilesRead), async (req, res) => {
    try {
        const { fileId } = req.params;
        const password = await s3Service_1.s3Service.getFilePassword(fileId);
        if (password === undefined) {
            return res.status(404).json({ error: 'File not found or no password set' });
        }
        res.json({
            fileId,
            hasPassword: !!password,
            password: password || null
        });
    }
    catch (error) {
        console.error('Get password error:', error);
        res.status(500).json({ error: 'Failed to get file password' });
    }
});
// Vector search in a specific file (便捷路由，對應 OpenAPI)
router.post('/:fileId/search', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.FilesRead, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const { fileId } = req.params;
        const { query, k = 5, minScore = 0.0 } = req.body;
        if (!query) {
            return res.status(400).json({
                error: 'query is required',
                hint: '請在請求 body 中提供 query 參數'
            });
        }
        const results = await vectorIndex_1.vectorIndexService.searchVector({
            fileId,
            query,
            k,
            minScore
        });
        res.json({
            results
        });
    }
    catch (error) {
        console.error('Vector search error:', error);
        if (error.message?.includes('not found') || error.message?.includes('not indexed')) {
            return res.status(404).json({
                error: 'Manual not found or not indexed yet',
                details: error.message,
                hint: '請確認檔案已上傳並完成索引'
            });
        }
        res.status(500).json({
            error: 'Search failed',
            details: error.message || 'Unknown error'
        });
    }
});
exports.default = router;
