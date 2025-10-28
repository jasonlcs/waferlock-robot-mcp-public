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
exports.s3Service = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = require("crypto");
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
const awsConfig_1 = require("./awsConfig");
const streamHelpers_1 = require("../utils/streamHelpers");
class S3Service {
    constructor() {
        this.files = new Map();
        this.initialized = false;
        this.initPromise = null;
        this.metadataKey = `${awsConfig_1.s3MetadataPrefix}/files.json`;
    }
    normalizeOriginalName(name) {
        if (!name) {
            return 'unnamed-file';
        }
        const containsNonLatin1 = Array.from(name).some((char) => char.charCodeAt(0) > 255);
        if (containsNonLatin1) {
            return name;
        }
        try {
            return Buffer.from(name, 'latin1').toString('utf8');
        }
        catch {
            return name;
        }
    }
    async ensureInitialized() {
        if (this.initialized) {
            return;
        }
        if (!this.initPromise) {
            this.initPromise = this.loadFilesFromS3()
                .catch((error) => {
                console.error('Error loading file metadata from S3:', error);
                throw error;
            })
                .finally(() => {
                this.initialized = true;
            });
        }
        await this.initPromise;
    }
    async loadFilesFromS3() {
        if (!awsConfig_1.hasAwsCredentials) {
            this.files.clear();
            return;
        }
        try {
            const command = new client_s3_1.GetObjectCommand({
                Bucket: awsConfig_1.s3BucketName,
                Key: this.metadataKey,
            });
            const response = await awsConfig_1.s3Client.send(command);
            const body = await streamHelpers_1.streamToString(response.Body);
            const filesArray = JSON.parse(body);
            filesArray.forEach((file) => {
                file.uploadedAt = new Date(file.uploadedAt);
                file.originalName = this.normalizeOriginalName(file.originalName);
                this.files.set(file.id, file);
            });
            console.log(`Loaded ${filesArray.length} file records from S3 metadata`);
        }
        catch (error) {
            if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
                console.log('No existing file metadata found in S3. Attempting backfill from bucket.');
                await this.backfillMetadataFromBucket();
                return;
            }
            throw error;
        }
    }
    async persistFilesToS3() {
        if (!awsConfig_1.hasAwsCredentials) {
            return;
        }
        const filesArray = Array.from(this.files.values());
        const payload = JSON.stringify(filesArray, null, 2);
        const command = new client_s3_1.PutObjectCommand({
            Bucket: awsConfig_1.s3BucketName,
            Key: this.metadataKey,
            Body: payload,
            ContentType: 'application/json',
        });
        await awsConfig_1.s3Client.send(command);
    }
    async validatePdfPassword(pdfBuffer, password) {
        try {
            // 簡單的 PDF 密碼檢查 - 檢查 PDF 是否有加密標誌
            const pdfSignature = pdfBuffer.toString('binary', 0, 4);
            // PDF 檔案應該以 %PDF 開頭
            if (pdfSignature !== '%PDF') {
                throw new Error('Invalid PDF file format');
            }
            // 檢查是否有加密（/Encrypt 物件通常表示密碼保護）
            // 只檢查前 50KB 以節省記憶體
            const checkLength = Math.min(50000, pdfBuffer.length);
            const pdfHeader = pdfBuffer.toString('binary', 0, checkLength);
            const isEncrypted = /\/Encrypt\s+\d+\s+\d+\s+R/.test(pdfHeader);
            if (isEncrypted && !password) {
                throw new Error('PDF password required');
            }
            // 密碼驗證已移除 (改用 Lambda 處理)
            // 如果 PDF 加密且提供密碼，我們只記錄但不驗證
            // 實際驗證會在 Lambda 建立索引時進行
            if (password && isEncrypted) {
                console.log('PDF password provided, will be used during indexing');
            }
        }
        catch (error) {
            if (error.message.includes('PDF password required') || error.message.includes('Invalid PDF password')) {
                throw error;
            }
            // 其他 PDF 驗證錯誤不應阻止上傳
            console.warn('PDF validation warning:', error.message);
        }
    }
    createStorageKey(originalName, fileId) {
        const timestamp = new Date()
            .toISOString()
            .replace(/[-:TZ.]/g, '')
            .slice(0, 14); // YYYYMMDDHHMMSS
        const extension = path_1.default.extname(originalName) || '';
        const filename = `${timestamp}-${fileId}${extension}`;
        return {
            s3Key: `manuals/${filename}`,
            filename,
        };
    }
    parseManualKey(key) {
        if (!key.startsWith('manuals/')) {
            return null;
        }
        const filename = key.substring('manuals/'.length);
        if (!filename) {
            return null;
        }
        // Legacy format: <uuid>-<originalName>
        const legacyMatch = filename.match(/^([0-9a-fA-F-]{36})-(.+)$/);
        if (legacyMatch) {
            const [, fileId, originalName] = legacyMatch;
            return { fileId, filename, originalName };
        }
        // New format: <timestamp>-<uuid>[<extension>]
        const modernMatch = filename.match(/^(\d{8,})-([0-9a-fA-F-]{36})(.*)$/);
        if (modernMatch) {
            const [, timestamp, fileId, suffix] = modernMatch;
            const placeholder = suffix ? `manual-${timestamp}${suffix}` : `manual-${timestamp}`;
            return { fileId, filename, originalName: placeholder };
        }
        return null;
    }
    async backfillMetadataFromBucket() {
        if (!awsConfig_1.hasAwsCredentials) {
            return;
        }
        const discovered = [];
        let continuationToken;
        do {
            const command = new client_s3_1.ListObjectsV2Command({
                Bucket: awsConfig_1.s3BucketName,
                Prefix: 'manuals/',
                ContinuationToken: continuationToken,
            });
            const response = await awsConfig_1.s3Client.send(command);
            const contents = response.Contents || [];
            for (const object of contents) {
                if (!object.Key) {
                    continue;
                }
                const parsed = this.parseManualKey(object.Key);
                if (!parsed) {
                    continue;
                }
                const head = await awsConfig_1.s3Client.send(new client_s3_1.HeadObjectCommand({
                    Bucket: awsConfig_1.s3BucketName,
                    Key: object.Key,
                }));
                const metadataNameB64 = head.Metadata?.['original-name-b64'];
                const metadataName = metadataNameB64
                    ? Buffer.from(metadataNameB64, 'base64').toString('utf8')
                    : head.Metadata?.originalname;
                const originalName = this.normalizeOriginalName(metadataName || parsed.originalName || parsed.filename);
                discovered.push({
                    id: parsed.fileId,
                    filename: parsed.filename,
                    originalName,
                    s3Key: object.Key,
                    uploadedAt: object.LastModified ? new Date(object.LastModified) : new Date(),
                    size: object.Size ?? 0,
                    contentType: head.ContentType || 'application/octet-stream',
                });
            }
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);
        if (discovered.length === 0) {
            this.files.clear();
            console.log('No manuals found in bucket during backfill.');
            return;
        }
        this.files.clear();
        discovered.forEach((file) => this.files.set(file.id, file));
        console.log(`Backfilled ${discovered.length} manuals from existing S3 objects.`);
        await this.persistFilesToS3();
    }
    async uploadFile(file, options) {
        await this.ensureInitialized();
        // Validate AWS credentials before attempting upload
        if (!awsConfig_1.hasAwsCredentials) {
            throw new Error('AWS_ACCESS_KEY_ID is not configured. Please set a valid AWS Access Key ID in your .env file');
        }
        const originalName = this.normalizeOriginalName(file.originalname);
        // 從磁碟讀取檔案（而非使用 file.buffer）
        let fileBuffer;
        if (file.path) {
            fileBuffer = fs.readFileSync(file.path);
        }
        else if (file.buffer) {
            // fallback for memory storage
            fileBuffer = file.buffer;
        }
        else {
            throw new Error('No file data available');
        }
        // 如果是 PDF，檢查是否需要密碼
        if (file.mimetype === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf')) {
            await this.validatePdfPassword(fileBuffer, options?.pdfPassword);
        }
        const fileId = crypto_1.randomUUID();
        const { s3Key, filename } = this.createStorageKey(originalName, fileId);
        try {
            const command = new client_s3_1.PutObjectCommand({
                Bucket: awsConfig_1.s3BucketName,
                Key: s3Key,
                Body: fileBuffer,
                ContentType: file.mimetype,
                Metadata: {
                    'original-name-b64': Buffer.from(originalName, 'utf8').toString('base64'),
                }
            });
            await awsConfig_1.s3Client.send(command);
        }
        catch (error) {
            // Provide more helpful error messages
            console.error('S3 Upload Error:', error);
            if (error.Code === 'AuthorizationHeaderMalformed') {
                throw new Error(`AWS credentials format error. Please verify:\n- AWS_ACCESS_KEY_ID is correct (starts with AKIA)\n- AWS_SECRET_ACCESS_KEY has no extra spaces\n- Credentials are valid for region: ${awsConfig_1.s3Region}`);
            }
            if (error.Code === 'InvalidAccessKeyId') {
                throw new Error('AWS Access Key ID is invalid. Please check your AWS_ACCESS_KEY_ID in .env file');
            }
            if (error.Code === 'SignatureDoesNotMatch') {
                throw new Error('AWS Secret Access Key is invalid. Please check your AWS_SECRET_ACCESS_KEY in .env file');
            }
            if (error.Code === 'NoSuchBucket') {
                throw new Error(`S3 Bucket "${awsConfig_1.s3BucketName}" does not exist. Please create it or update S3_BUCKET_NAME in .env file`);
            }
            throw error;
        }
        const uploadedFile = {
            id: fileId,
            filename,
            originalName,
            s3Key,
            uploadedAt: new Date(),
            size: file.size,
            contentType: file.mimetype,
            pdfPassword: options?.pdfPassword
        };
        this.files.set(fileId, uploadedFile);
        await this.persistFilesToS3();
        console.log(`File uploaded to S3: ${originalName}. Vector indexing will be triggered separately.`);
        return uploadedFile;
    }
    async getFile(s3Key) {
        const command = new client_s3_1.GetObjectCommand({
            Bucket: awsConfig_1.s3BucketName,
            Key: s3Key,
        });
        const response = await awsConfig_1.s3Client.send(command);
        return streamHelpers_1.streamToBuffer(response.Body);
    }
    async listFiles() {
        await this.ensureInitialized();
        return Array.from(this.files.values());
    }
    async getFileById(fileId) {
        await this.ensureInitialized();
        return this.files.get(fileId);
    }
    async updateFileMetadata(fileId, updates) {
        await this.ensureInitialized();
        const file = this.files.get(fileId);
        if (!file) {
            throw new Error(`File not found: ${fileId}`);
        }
        Object.assign(file, updates);
        this.files.set(fileId, file);
        await this.persistFilesToS3();
    }
    async generateDownloadUrl(fileId, options) {
        await this.ensureInitialized();
        const file = this.files.get(fileId);
        if (!file) {
            return undefined;
        }
        if (!awsConfig_1.hasAwsCredentials) {
            throw new Error('AWS credentials are required to generate download URLs');
        }
        const expiresInput = options?.expiresInSeconds;
        const expiresIn = typeof expiresInput === 'number' && Number.isFinite(expiresInput) && expiresInput > 0
            ? Math.min(Math.floor(expiresInput), 60 * 60)
            : 900;
        const command = new client_s3_1.GetObjectCommand({
            Bucket: awsConfig_1.s3BucketName,
            Key: file.s3Key,
        });
        return s3_request_presigner_1.getSignedUrl(awsConfig_1.s3Client, command, { expiresIn });
    }
    async downloadFileBuffer(fileId) {
        await this.ensureInitialized();
        const file = this.files.get(fileId);
        if (!file) {
            return undefined;
        }
        if (!awsConfig_1.hasAwsCredentials) {
            throw new Error('AWS credentials are required to download files');
        }
        const command = new client_s3_1.GetObjectCommand({
            Bucket: awsConfig_1.s3BucketName,
            Key: file.s3Key,
        });
        const response = await awsConfig_1.s3Client.send(command);
        const buffer = await streamHelpers_1.streamToBuffer(response.Body);
        return { file, buffer };
    }
    async getFilePassword(fileId) {
        await this.ensureInitialized();
        const file = this.files.get(fileId);
        return file?.pdfPassword;
    }
    async deleteFile(fileId) {
        await this.ensureInitialized();
        const file = this.files.get(fileId);
        if (!file) {
            return false;
        }
        try {
            await awsConfig_1.s3Client.send(new client_s3_1.DeleteObjectCommand({
                Bucket: awsConfig_1.s3BucketName,
                Key: file.s3Key,
            }));
        }
        catch (error) {
            console.error('S3 Delete Error:', error);
            if (error.Code === 'NoSuchKey') {
                console.warn(`S3 object already missing for key ${file.s3Key}. Continuing cleanup.`);
            }
            else {
                throw error;
            }
        }
        this.files.delete(fileId);
        await this.persistFilesToS3();
        return true;
    }
}
exports.s3Service = new S3Service();
