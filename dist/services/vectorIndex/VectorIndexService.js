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
Object.defineProperty(exports, "__esModule", { value: true });
exports.vectorIndexService = exports.VectorIndexService = void 0;
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
const s3Service_1 = require("../s3Service");
const lambdaIndexer_1 = require("../lambdaIndexer");
const EmbeddingService_1 = require("./EmbeddingService");
const FaissIndexManager_1 = require("./FaissIndexManager");
const CheckpointManager_1 = require("./CheckpointManager");
const JobLockManager_1 = require("./JobLockManager");
const vectorIndex_1 = require("../../types/vectorIndex");
const client_s3_1 = require("@aws-sdk/client-s3");
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const s3BucketName = process.env.S3_BUCKET_NAME || '';
const DEFAULT_CONFIG = {
    batchSize: 100,
    maxChunksInMemory: 100,
    maxVectorsInMemory: 500,
    checkpointInterval: 50,
    gcInterval: 200,
    maxRetries: 3,
    embeddingModel: 'text-embedding-3-small',
    dimensions: 1536,
    indexType: 'hnsw',
};
class VectorIndexService {
    constructor(config = {}) {
        this.jobs = new Map();
        this.tempDir = './data/temp';
        this.jobsLoaded = false;
        this.JOB_RETENTION_DAYS = 7;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.embeddingService = new EmbeddingService_1.EmbeddingService(this.config.embeddingModel, this.config.dimensions, this.config.maxRetries);
        this.jobLockManager = new JobLockManager_1.JobLockManager();
        this.checkpointManager = new CheckpointManager_1.CheckpointManager();
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        // 啟動時從 S3 載入 jobs
        this.loadJobsFromS3().catch(error => {
            console.error('Failed to load jobs from S3:', error);
        });
        // 每天清理一次過期的 jobs
        setInterval(() => {
            this.cleanupOldJobsFromS3().catch(error => {
                console.error('Failed to cleanup old jobs:', error);
            });
        }, 24 * 60 * 60 * 1000); // 24 小時
    }
    /**
     * 啟動向量索引任務
     */
    async startIndexing(fileId, fileName, forceRebuild = false) {
        // 先清理過期的鎖定
        this.jobLockManager.cleanupExpiredLocks();
        // 檢查全域鎖定
        if (this.jobLockManager.isGloballyLocked()) {
            if (!forceRebuild) {
                throw new Error('Another indexing job is in progress. Please wait.');
            }
            console.warn('Force rebuild requested, releasing existing lock');
            this.jobLockManager.releaseGlobalLock();
        }
        // 檢查檔案鎖定
        if (this.jobLockManager.isFileLocked(fileId)) {
            if (!forceRebuild) {
                throw new Error(`File ${fileId} is already being indexed.`);
            }
            console.warn(`Force rebuild requested for file ${fileId}, releasing existing lock`);
            this.jobLockManager.releaseFileLock(fileId);
        }
        const jobId = crypto_1.randomUUID();
        // 取得全域鎖定
        if (!this.jobLockManager.acquireGlobalLock(jobId)) {
            throw new Error('Failed to acquire global lock');
        }
        // 取得檔案鎖定
        if (!this.jobLockManager.acquireFileLock(fileId, jobId)) {
            this.jobLockManager.releaseGlobalLock();
            throw new Error(`Failed to acquire lock for file ${fileId}`);
        }
        // 建立任務
        const job = {
            jobId,
            fileId,
            fileName,
            status: vectorIndex_1.VectorIndexStatus.PENDING,
            stage: vectorIndex_1.VectorIndexStage.INITIALIZATION,
            progress: {
                current: 0,
                total: 0,
                percentage: 0,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.jobs.set(jobId, job);
        // 保存 job 到 S3
        await this.saveJobToS3(job);
        // 在背景執行索引
        this.processIndexing(jobId, fileId, fileName).catch(error => {
            console.error(`Indexing job ${jobId} failed:`, error);
            this.handleJobError(jobId, error);
            // 確保釋放鎖定
            this.cleanup(jobId, fileId);
        });
        return jobId;
    }
    /**
     * 處理索引流程 (使用 Lambda 處理)
     */
    async processIndexing(jobId, fileId, fileName) {
        const job = this.jobs.get(jobId);
        if (!job) {
            console.error(`Job ${jobId} not found`);
            return;
        }
        try {
            // 更新任務狀態為進行中
            job.status = vectorIndex_1.VectorIndexStatus.EXTRACTING;
            job.stage = vectorIndex_1.VectorIndexStage.TEXT_EXTRACTION;
            job.updatedAt = new Date();
            // 獲取檔案的 S3 Key
            const files = await s3Service_1.s3Service.listFiles();
            const fileMetadata = files.find(f => f.id === fileId);
            if (!fileMetadata) {
                throw new Error(`File metadata not found for ${fileId}`);
            }
            console.log(`🚀 Triggering Lambda indexer for ${fileName} (${fileId})`);
            console.log(`   S3 Key: ${fileMetadata.s3Key}`);
            // 觸發 Lambda 索引
            const success = await lambdaIndexer_1.lambdaIndexerService.triggerIndexing(fileId, fileName, fileMetadata.s3Key, jobId);
            if (success) {
                // Lambda 已成功觸發，更新任務狀態
                job.status = vectorIndex_1.VectorIndexStatus.INDEXING;
                job.stage = vectorIndex_1.VectorIndexStage.INDEX_BUILDING;
                job.updatedAt = new Date();
                console.log(`✅ Lambda indexer triggered successfully for ${fileName}`);
                console.log(`   Job ID: ${jobId}`);
                console.log(`   Lambda will callback when indexing completes`);
            }
            else {
                throw new Error('Failed to trigger Lambda indexer');
            }
        }
        catch (error) {
            console.error(`❌ Lambda indexing failed for ${fileName}:`, error.message);
            if (job) {
                job.status = vectorIndex_1.VectorIndexStatus.FAILED;
                job.error = error.message;
                job.updatedAt = new Date();
            }
        }
        finally {
            // 注意：不要在這裡釋放鎖定
            // Lambda callback 會負責完成後的清理工作
        }
    }
    /**
     * 從進度追蹤器更新任務
     */
    updateJobFromTracker(jobId, tracker) {
        const job = this.jobs.get(jobId);
        if (job) {
            const stats = tracker.getStats();
            job.status = stats.currentStatus;
            job.stage = stats.currentStage;
            job.progress = stats.progress;
            job.updatedAt = new Date();
        }
    }
    /**
     * 處理任務錯誤
     */
    handleJobError(jobId, error) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = vectorIndex_1.VectorIndexStatus.FAILED;
            job.error = error.message || String(error);
            job.updatedAt = new Date();
            // 釋放鎖定
            if (job.fileId) {
                this.jobLockManager.releaseFileLock(job.fileId);
            }
            this.jobLockManager.releaseGlobalLock();
        }
    }
    /**
     * 上傳檔案到 S3
     */
    async uploadFileToS3(localPath, s3Key) {
        const fileContent = fs.readFileSync(localPath);
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: s3BucketName,
            Key: s3Key,
            Body: fileContent,
        }));
        return `s3://${s3BucketName}/${s3Key}`;
    }
    /**
     * 計算檔案 checksum
     */
    async calculateChecksum(filePath) {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    /**
     * 清理臨時檔案
     */
    cleanup(jobId, fileId, ...filePaths) {
        // 刪除臨時檔案
        for (const filePath of filePaths) {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        // 釋放鎖定
        this.jobLockManager.releaseFileLock(fileId);
        this.jobLockManager.releaseGlobalLock();
        console.log(`Cleanup completed for job ${jobId}`);
    }
    /**
     * 取得任務狀態
     */
    getJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return undefined;
        const now = Date.now();
        const timeout = 15 * 60 * 1000; // 15 分鐘超時
        // 檢查是否超時（只檢查未完成的任務）
        if (!job.completedAt && // 沒有完成時間
            (job.status === vectorIndex_1.VectorIndexStatus.INDEXING ||
                job.status === vectorIndex_1.VectorIndexStatus.EXTRACTING ||
                job.status === vectorIndex_1.VectorIndexStatus.PENDING) &&
            now - job.createdAt.getTime() > timeout) {
            console.warn(`Job ${job.jobId} has timed out after ${timeout / 1000}s`);
            job.status = vectorIndex_1.VectorIndexStatus.FAILED;
            job.error = `Timeout: No callback received after ${timeout / 60000} minutes. Lambda may have failed silently.`;
            job.updatedAt = new Date();
            // 釋放鎖定
            this.jobLockManager.releaseFileLock(job.fileId);
            this.jobLockManager.releaseGlobalLock();
            // 保存更新到 S3
            this.saveJobToS3(job).catch(err => {
                console.error(`Failed to save timeout update for job ${job.jobId}:`, err);
            });
        }
        return job;
    }
    /**
     * 從 Lambda callback 更新任務狀態
     */
    async updateJobFromCallback(jobId, success, error, metrics) {
        const job = this.jobs.get(jobId);
        if (!job) {
            console.warn(`Job ${jobId} not found for callback update`);
            return;
        }
        try {
            if (success) {
                job.status = vectorIndex_1.VectorIndexStatus.COMPLETED;
                job.stage = vectorIndex_1.VectorIndexStage.COMPLETED;
                job.progress = {
                    current: 100,
                    total: 100,
                    percentage: 100,
                };
                job.completedAt = new Date();
                job.updatedAt = new Date();
                // 更新統計資料
                if (metrics) {
                    job.processingTime = metrics.processingTime;
                    job.stats = metrics.stats;
                    job.numChunks = metrics.numChunks;
                    job.numVectors = metrics.numVectors;
                    // 計算費用
                    job.costs = this.calculateCosts(metrics);
                }
                console.log(`✅ Job ${jobId} completed successfully via Lambda callback`);
                if (job.processingTime) {
                    console.log(`   Processing time: ${job.processingTime.toFixed(2)}s`);
                }
                if (job.costs) {
                    console.log(`   Estimated cost: $${job.costs.total.toFixed(6)}`);
                }
            }
            else {
                job.status = vectorIndex_1.VectorIndexStatus.FAILED;
                job.error = error || 'Lambda indexing failed';
                job.updatedAt = new Date();
                console.error(`❌ Job ${jobId} failed via Lambda callback: ${error}`);
            }
            // 保存更新到 S3
            await this.saveJobToS3(job);
        }
        finally {
            // 釋放鎖定
            this.jobLockManager.releaseFileLock(job.fileId);
            this.jobLockManager.releaseGlobalLock();
            console.log(`🔓 Locks released for job ${jobId}`);
        }
    }
    /**
     * 計算執行費用
     */
    calculateCosts(metrics) {
        const costs = {
            lambda: 0,
            embedding: 0,
            total: 0
        };
        // Lambda 費用計算
        // AWS Lambda 定價 (us-east-1, 2024):
        // - $0.0000166667 per GB-second (128MB = 0.125GB)
        // - $0.20 per 1M requests
        if (metrics.processingTime) {
            const memoryGB = 0.512; // 512MB = 0.5GB
            const gbSeconds = memoryGB * metrics.processingTime;
            costs.lambda = gbSeconds * 0.0000166667 + 0.0000002; // + per request cost
        }
        // OpenAI Embedding API 費用
        // text-embedding-3-small: $0.00002 per 1K tokens
        // 假設平均每個 chunk 約 500 tokens
        if (metrics.numVectors) {
            const estimatedTokens = metrics.numVectors * 500;
            costs.embedding = (estimatedTokens / 1000) * 0.00002;
        }
        costs.total = costs.lambda + costs.embedding;
        return costs;
    }
    /**
     * 列出所有任務
     */
    listJobs() {
        const jobs = Array.from(this.jobs.values());
        const now = Date.now();
        const timeout = 15 * 60 * 1000; // 15 分鐘超時
        // 檢查並標記超時的任務（只檢查未完成的任務）
        for (const job of jobs) {
            if (!job.completedAt && // 沒有完成時間
                (job.status === vectorIndex_1.VectorIndexStatus.INDEXING ||
                    job.status === vectorIndex_1.VectorIndexStatus.EXTRACTING ||
                    job.status === vectorIndex_1.VectorIndexStatus.PENDING) &&
                now - job.createdAt.getTime() > timeout) {
                console.warn(`Job ${job.jobId} has timed out after ${timeout / 1000}s`);
                job.status = vectorIndex_1.VectorIndexStatus.FAILED;
                job.error = `Timeout: No callback received after ${timeout / 60000} minutes. Lambda may have failed silently.`;
                job.updatedAt = new Date();
                // 釋放鎖定
                this.jobLockManager.releaseFileLock(job.fileId);
                this.jobLockManager.releaseGlobalLock();
                // 保存更新到 S3
                this.saveJobToS3(job).catch(err => {
                    console.error(`Failed to save timeout update for job ${job.jobId}:`, err);
                });
            }
        }
        return jobs;
    }
    /**
     * 取消任務
     */
    async cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            return false;
        }
        if (job.status === vectorIndex_1.VectorIndexStatus.COMPLETED || job.status === vectorIndex_1.VectorIndexStatus.FAILED) {
            return false;
        }
        job.status = vectorIndex_1.VectorIndexStatus.CANCELLED;
        job.updatedAt = new Date();
        this.jobLockManager.releaseFileLock(job.fileId);
        this.jobLockManager.releaseGlobalLock();
        // 保存更新到 S3
        await this.saveJobToS3(job);
        return true;
    }
    /**
     * 搜索向量索引
     */
    async searchVector(request) {
        const { fileId, query, k = 5, minScore = 0.0 } = request;
        if (!fileId) {
            throw new Error('fileId is required for vector search');
        }
        // 1. 從 S3 下載索引和元數據
        const indexKey = `vector-indexes/${fileId}.index`;
        const metadataKey = `vector-indexes/${fileId}.metadata.json`;
        let indexBuffer;
        let rawMetadata;
        try {
            // 下載索引檔案
            const indexCmd = new client_s3_1.GetObjectCommand({
                Bucket: s3BucketName,
                Key: indexKey,
            });
            const indexResponse = await s3Client.send(indexCmd);
            indexBuffer = await this.streamToBuffer(indexResponse.Body);
            // 下載元數據
            const metadataCmd = new client_s3_1.GetObjectCommand({
                Bucket: s3BucketName,
                Key: metadataKey,
            });
            const metadataResponse = await s3Client.send(metadataCmd);
            const metadataBuffer = await this.streamToBuffer(metadataResponse.Body);
            rawMetadata = JSON.parse(metadataBuffer.toString('utf-8'));
        }
        catch (error) {
            throw new Error(`Failed to load vector index for file ${fileId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        // 2. 儲存索引到臨時檔案並載入
        const tempIndexPath = path.join(this.tempDir, `search-${fileId}-${Date.now()}.index`);
        fs.writeFileSync(tempIndexPath, indexBuffer);
        const indexManager = new FaissIndexManager_1.FaissIndexManager(this.config.dimensions);
        try {
            await indexManager.load(tempIndexPath);
            // 3. 將查詢文字轉為向量
            const queryEmbedding = await this.embeddingService.embedText(query);
            // 4. 搜索最近鄰 (FAISS uses Inner Product, higher is better)
            const searchResults = await indexManager.search(queryEmbedding, k);
            // 5. 組合結果 - 使用實際的 metadata 欄位名稱
            const results = [];
            for (let i = 0; i < searchResults.labels.length; i++) {
                const vectorId = searchResults.labels[i];
                const distance = searchResults.distances[i];
                // FAISS Inner Product: higher score = more similar
                const score = distance;
                if (score < minScore) {
                    continue;
                }
                const rawMeta = rawMetadata[vectorId];
                if (rawMeta) {
                    // 將原始 metadata 轉換為標準格式
                    const standardMetadata = {
                        chunkId: `${rawMeta.fileId}-chunk-${rawMeta.chunkIndex}`,
                        fileId: rawMeta.fileId,
                        vectorId: vectorId,
                        content: rawMeta.text || '',
                        startIndex: rawMeta.startWord || 0,
                        endIndex: rawMeta.endWord || 0,
                        chunkOrder: rawMeta.chunkIndex || 0,
                        createdAt: new Date(),
                    };
                    results.push({
                        chunkId: standardMetadata.chunkId,
                        fileId: standardMetadata.fileId,
                        content: standardMetadata.content,
                        score,
                        metadata: standardMetadata,
                    });
                }
            }
            return results;
        }
        finally {
            // 清理臨時檔案
            if (fs.existsSync(tempIndexPath)) {
                fs.unlinkSync(tempIndexPath);
            }
        }
    }
    /**
     * 輔助函數：將 Stream 轉為 Buffer
     */
    async streamToBuffer(stream) {
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    /**
     * Search across all indexed manuals simultaneously
     */
    async searchAllManuals(query, k = 5, minScore = 0.5) {
        try {
            const listCmd = new client_s3_1.ListObjectsV2Command({
                Bucket: s3BucketName,
                Prefix: 'vector-indexes/',
            });
            const response = await s3Client.send(listCmd);
            const indexFiles = (response.Contents || [])
                .filter((obj) => obj.Key?.endsWith('.index'))
                .map((obj) => {
                const match = obj.Key?.match(/vector-indexes\/(.+)\.index$/);
                return match ? match[1] : null;
            })
                .filter((id) => id !== null);
            if (indexFiles.length === 0) {
                return [];
            }
            // Search each file and collect results
            const allResults = [];
            for (const fileId of indexFiles) {
                try {
                    const results = await this.searchVector({
                        fileId,
                        query,
                        k: Math.ceil(k / indexFiles.length) + 2,
                        minScore,
                    });
                    allResults.push(...results);
                }
                catch (error) {
                    console.error(`Failed to search file ${fileId}:`, error);
                }
            }
            // Sort by score and return top k
            allResults.sort((a, b) => b.score - a.score);
            return allResults.slice(0, k);
        }
        catch (error) {
            throw new Error(`Failed to search all manuals: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * 從 S3 載入所有 jobs
     */
    async loadJobsFromS3() {
        if (this.jobsLoaded)
            return;
        try {
            console.log('Loading jobs from S3...');
            const { ListObjectsV2Command } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/client-s3')));
            const listCommand = new ListObjectsV2Command({
                Bucket: s3BucketName,
                Prefix: 'jobs/',
            });
            const listResponse = await s3Client.send(listCommand);
            if (!listResponse.Contents || listResponse.Contents.length === 0) {
                console.log('No jobs found in S3');
                this.jobsLoaded = true;
                return;
            }
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.JOB_RETENTION_DAYS);
            let loadedCount = 0;
            let skippedCount = 0;
            for (const item of listResponse.Contents) {
                if (!item.Key || !item.Key.endsWith('.json'))
                    continue;
                // 檢查是否過期
                if (item.LastModified && item.LastModified < cutoffDate) {
                    skippedCount++;
                    continue;
                }
                try {
                    const getCommand = new client_s3_1.GetObjectCommand({
                        Bucket: s3BucketName,
                        Key: item.Key,
                    });
                    const response = await s3Client.send(getCommand);
                    const jobData = await this.streamToBuffer(response.Body);
                    const job = JSON.parse(jobData.toString('utf-8'));
                    // 轉換日期字串為 Date 物件
                    job.createdAt = new Date(job.createdAt);
                    job.updatedAt = new Date(job.updatedAt);
                    if (job.completedAt) {
                        job.completedAt = new Date(job.completedAt);
                    }
                    this.jobs.set(job.jobId, job);
                    loadedCount++;
                }
                catch (error) {
                    console.error(`Failed to load job from ${item.Key}:`, error);
                }
            }
            console.log(`✓ Loaded ${loadedCount} jobs from S3 (skipped ${skippedCount} old jobs)`);
            this.jobsLoaded = true;
        }
        catch (error) {
            console.error('Error loading jobs from S3:', error);
            this.jobsLoaded = true;
        }
    }
    /**
     * 保存單個 job 到 S3
     */
    async saveJobToS3(job) {
        try {
            const jobKey = `jobs/${job.jobId}.json`;
            const jobData = JSON.stringify(job, null, 2);
            await s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: s3BucketName,
                Key: jobKey,
                Body: jobData,
                ContentType: 'application/json',
            }));
            // console.log(`✓ Saved job ${job.jobId} to S3`);
        }
        catch (error) {
            console.error(`Failed to save job ${job.jobId} to S3:`, error);
        }
    }
    /**
     * 從 S3 刪除過期的 jobs
     */
    async cleanupOldJobsFromS3() {
        try {
            const { ListObjectsV2Command, DeleteObjectCommand } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/client-s3')));
            const listCommand = new ListObjectsV2Command({
                Bucket: s3BucketName,
                Prefix: 'jobs/',
            });
            const listResponse = await s3Client.send(listCommand);
            if (!listResponse.Contents)
                return;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.JOB_RETENTION_DAYS);
            let deletedCount = 0;
            for (const item of listResponse.Contents) {
                if (!item.Key || !item.LastModified)
                    continue;
                if (item.LastModified < cutoffDate) {
                    try {
                        await s3Client.send(new DeleteObjectCommand({
                            Bucket: s3BucketName,
                            Key: item.Key,
                        }));
                        deletedCount++;
                    }
                    catch (error) {
                        console.error(`Failed to delete old job ${item.Key}:`, error);
                    }
                }
            }
            if (deletedCount > 0) {
                console.log(`✓ Cleaned up ${deletedCount} old jobs from S3`);
            }
        }
        catch (error) {
            console.error('Error cleaning up old jobs from S3:', error);
        }
    }
}
exports.VectorIndexService = VectorIndexService;
// 單例
exports.vectorIndexService = new VectorIndexService();
