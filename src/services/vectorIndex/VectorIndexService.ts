import { randomUUID } from 'crypto';
import * as path from 'path';
import { s3Service } from '../s3Service';
import { contentExtractionService } from '../contentExtractionService';
import { lambdaIndexerService } from '../lambdaIndexer';
import { EmbeddingService } from './EmbeddingService';
import { HNSWIndexManager } from './HNSWIndexManager';
import { FaissIndexManager } from './FaissIndexManager';
import { MetadataStore } from './MetadataStore';
import { ProgressTracker } from './ProgressTracker';
import { CheckpointManager } from './CheckpointManager';
import { JobLockManager } from './JobLockManager';
import {
  VectorIndexJob,
  VectorIndexStatus,
  VectorIndexStage,
  VectorIndexConfig,
  VectorIndexManifest,
  VectorMetadata,
  VectorSearchRequest,
  VectorSearchResult,
} from '../../types/vectorIndex';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as crypto from 'crypto';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const s3BucketName = process.env.S3_BUCKET_NAME || '';

const DEFAULT_CONFIG: VectorIndexConfig = {
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

export class VectorIndexService {
  private jobs: Map<string, VectorIndexJob> = new Map();
  private config: VectorIndexConfig;
  private embeddingService: EmbeddingService;
  private jobLockManager: JobLockManager;
  private checkpointManager: CheckpointManager;
  private tempDir: string = './data/temp';
  private jobsLoaded: boolean = false;
  private readonly JOB_RETENTION_DAYS = 7;

  constructor(config: Partial<VectorIndexConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embeddingService = new EmbeddingService(
      this.config.embeddingModel,
      this.config.dimensions,
      this.config.maxRetries
    );
    this.jobLockManager = new JobLockManager();
    this.checkpointManager = new CheckpointManager();

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
  async startIndexing(fileId: string, fileName: string, forceRebuild: boolean = false): Promise<string> {
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

    const jobId = randomUUID();

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
    const job: VectorIndexJob = {
      jobId,
      fileId,
      fileName,
      status: VectorIndexStatus.PENDING,
      stage: VectorIndexStage.INITIALIZATION,
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
  private async processIndexing(jobId: string, fileId: string, fileName: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.error(`Job ${jobId} not found`);
      return;
    }

    try {
      // 更新任務狀態為進行中
      job.status = VectorIndexStatus.EXTRACTING;
      job.stage = VectorIndexStage.TEXT_EXTRACTION;
      job.updatedAt = new Date();

      // 獲取檔案的 S3 Key
      const files = await s3Service.listFiles();
      const fileMetadata = files.find(f => f.id === fileId);
      
      if (!fileMetadata) {
        throw new Error(`File metadata not found for ${fileId}`);
      }

      console.log(`🚀 Triggering Lambda indexer for ${fileName} (${fileId})`);
      console.log(`   S3 Key: ${fileMetadata.s3Key}`);

      // 觸發 Lambda 索引
      const success = await lambdaIndexerService.triggerIndexing(
        fileId,
        fileName,
        fileMetadata.s3Key,
        jobId
      );

      if (success) {
        // Lambda 已成功觸發，更新任務狀態
        job.status = VectorIndexStatus.INDEXING;
        job.stage = VectorIndexStage.INDEX_BUILDING;
        job.updatedAt = new Date();
        
        console.log(`✅ Lambda indexer triggered successfully for ${fileName}`);
        console.log(`   Job ID: ${jobId}`);
        console.log(`   Lambda will callback when indexing completes`);
      } else {
        throw new Error('Failed to trigger Lambda indexer');
      }
    } catch (error: any) {
      console.error(`❌ Lambda indexing failed for ${fileName}:`, error.message);
      
      if (job) {
        job.status = VectorIndexStatus.FAILED;
        job.error = error.message;
        job.updatedAt = new Date();
      }
    } finally {
      // 注意：不要在這裡釋放鎖定
      // Lambda callback 會負責完成後的清理工作
    }
  }

  /**
   * 從進度追蹤器更新任務
   */
  private updateJobFromTracker(jobId: string, tracker: ProgressTracker): void {
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
  private handleJobError(jobId: string, error: any): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = VectorIndexStatus.FAILED;
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
  private async uploadFileToS3(localPath: string, s3Key: string): Promise<string> {
    const fileContent = fs.readFileSync(localPath);
    
    await s3Client.send(new PutObjectCommand({
      Bucket: s3BucketName,
      Key: s3Key,
      Body: fileContent,
    }));

    return `s3://${s3BucketName}/${s3Key}`;
  }

  /**
   * 計算檔案 checksum
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 清理臨時檔案
   */
  private cleanup(jobId: string, fileId: string, ...filePaths: string[]): void {
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
  getJob(jobId: string): VectorIndexJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    const now = Date.now();
    const timeout = 15 * 60 * 1000; // 15 分鐘超時

    // 檢查是否超時（只檢查未完成的任務）
    if (
      !job.completedAt && // 沒有完成時間
      (job.status === VectorIndexStatus.INDEXING || 
       job.status === VectorIndexStatus.EXTRACTING ||
       job.status === VectorIndexStatus.PENDING) &&
      now - job.createdAt.getTime() > timeout
    ) {
      console.warn(`Job ${job.jobId} has timed out after ${timeout / 1000}s`);
      job.status = VectorIndexStatus.FAILED;
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
  async updateJobFromCallback(
    jobId: string, 
    success: boolean, 
    error?: string,
    metrics?: {
      processingTime?: number;
      stats?: any;
      numChunks?: number;
      numVectors?: number;
    }
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`Job ${jobId} not found for callback update`);
      return;
    }

    try {
      if (success) {
        job.status = VectorIndexStatus.COMPLETED;
        job.stage = VectorIndexStage.COMPLETED;
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
      } else {
        job.status = VectorIndexStatus.FAILED;
        job.error = error || 'Lambda indexing failed';
        job.updatedAt = new Date();
        
        console.error(`❌ Job ${jobId} failed via Lambda callback: ${error}`);
      }

      // 保存更新到 S3
      await this.saveJobToS3(job);
    } finally {
      // 釋放鎖定
      this.jobLockManager.releaseFileLock(job.fileId);
      this.jobLockManager.releaseGlobalLock();
      
      console.log(`🔓 Locks released for job ${jobId}`);
    }
  }

  /**
   * 計算執行費用
   */
  private calculateCosts(metrics: {
    processingTime?: number;
    stats?: any;
    numChunks?: number;
    numVectors?: number;
  }): { lambda: number; embedding: number; total: number } {
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
  listJobs(): VectorIndexJob[] {
    const jobs = Array.from(this.jobs.values());
    const now = Date.now();
    const timeout = 15 * 60 * 1000; // 15 分鐘超時

    // 檢查並標記超時的任務（只檢查未完成的任務）
    for (const job of jobs) {
      if (
        !job.completedAt && // 沒有完成時間
        (job.status === VectorIndexStatus.INDEXING || 
         job.status === VectorIndexStatus.EXTRACTING ||
         job.status === VectorIndexStatus.PENDING) &&
        now - job.createdAt.getTime() > timeout
      ) {
        console.warn(`Job ${job.jobId} has timed out after ${timeout / 1000}s`);
        job.status = VectorIndexStatus.FAILED;
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
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === VectorIndexStatus.COMPLETED || job.status === VectorIndexStatus.FAILED) {
      return false;
    }

    job.status = VectorIndexStatus.CANCELLED;
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
  async searchVector(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const { fileId, query, k = 5, minScore = 0.0 } = request;

    if (!fileId) {
      throw new Error('fileId is required for vector search');
    }

    // 1. 從 S3 下載索引和元數據
    const indexKey = `vector-indexes/${fileId}.index`;
    const metadataKey = `vector-indexes/${fileId}.metadata.json`;

    let indexBuffer: Buffer;
    let rawMetadata: any[];

    try {
      // 下載索引檔案
      const indexCmd = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: indexKey,
      });
      const indexResponse = await s3Client.send(indexCmd);
      indexBuffer = await this.streamToBuffer(indexResponse.Body);

      // 下載元數據
      const metadataCmd = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: metadataKey,
      });
      const metadataResponse = await s3Client.send(metadataCmd);
      const metadataBuffer = await this.streamToBuffer(metadataResponse.Body);
      rawMetadata = JSON.parse(metadataBuffer.toString('utf-8'));
    } catch (error) {
      throw new Error(
        `Failed to load vector index for file ${fileId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // 2. 儲存索引到臨時檔案並載入
    const tempIndexPath = path.join(this.tempDir, `search-${fileId}-${Date.now()}.index`);
    fs.writeFileSync(tempIndexPath, indexBuffer);

    const indexManager = new FaissIndexManager(this.config.dimensions);

    try {
      await indexManager.load(tempIndexPath);

      // 3. 將查詢文字轉為向量
      const queryEmbedding = await this.embeddingService.embedText(query);

      // 4. 搜索最近鄰 (FAISS uses Inner Product, higher is better)
      const searchResults = await indexManager.search(queryEmbedding, k);

      // 5. 組合結果 - 使用實際的 metadata 欄位名稱
      const results: VectorSearchResult[] = [];
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
          const standardMetadata: VectorMetadata = {
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
    } finally {
      // 清理臨時檔案
      if (fs.existsSync(tempIndexPath)) {
        fs.unlinkSync(tempIndexPath);
      }
    }
  }

  /**
   * 輔助函數：將 Stream 轉為 Buffer
   */
  private async streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Search across all indexed manuals simultaneously
   */
  async searchAllManuals(query: string, k: number = 5, minScore: number = 0.5): Promise<VectorSearchResult[]> {
    try {
      const listCmd = new ListObjectsV2Command({
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
        .filter((id): id is string => id !== null);

      if (indexFiles.length === 0) {
        return [];
      }

      // Search each file and collect results
      const allResults: VectorSearchResult[] = [];
      
      for (const fileId of indexFiles) {
        try {
          const results = await this.searchVector({
            fileId,
            query,
            k: Math.ceil(k / indexFiles.length) + 2,
            minScore,
          });
          allResults.push(...results);
        } catch (error) {
          console.error(`Failed to search file ${fileId}:`, error);
        }
      }

      // Sort by score and return top k
      allResults.sort((a, b) => b.score - a.score);
      return allResults.slice(0, k);
      
    } catch (error) {
      throw new Error(
        `Failed to search all manuals: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 從 S3 載入所有 jobs
   */
  private async loadJobsFromS3(): Promise<void> {
    if (this.jobsLoaded) return;

    try {
      if (process.env.DEBUG_MCP) {
        console.error('Loading jobs from S3...');
      }
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      
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
        if (!item.Key || !item.Key.endsWith('.json')) continue;

        // 檢查是否過期
        if (item.LastModified && item.LastModified < cutoffDate) {
          skippedCount++;
          continue;
        }

        try {
          const getCommand = new GetObjectCommand({
            Bucket: s3BucketName,
            Key: item.Key,
          });

          const response = await s3Client.send(getCommand);
          const jobData = await this.streamToBuffer(response.Body);
          const job: VectorIndexJob = JSON.parse(jobData.toString('utf-8'));

          // 轉換日期字串為 Date 物件
          job.createdAt = new Date(job.createdAt);
          job.updatedAt = new Date(job.updatedAt);
          if (job.completedAt) {
            job.completedAt = new Date(job.completedAt);
          }

          this.jobs.set(job.jobId, job);
          loadedCount++;
        } catch (error) {
          console.error(`Failed to load job from ${item.Key}:`, error);
        }
      }

      console.log(`✓ Loaded ${loadedCount} jobs from S3 (skipped ${skippedCount} old jobs)`);
      this.jobsLoaded = true;
    } catch (error) {
      console.error('Error loading jobs from S3:', error);
      this.jobsLoaded = true;
    }
  }

  /**
   * 保存單個 job 到 S3
   */
  private async saveJobToS3(job: VectorIndexJob): Promise<void> {
    try {
      const jobKey = `jobs/${job.jobId}.json`;
      const jobData = JSON.stringify(job, null, 2);

      await s3Client.send(new PutObjectCommand({
        Bucket: s3BucketName,
        Key: jobKey,
        Body: jobData,
        ContentType: 'application/json',
      }));

      // console.log(`✓ Saved job ${job.jobId} to S3`);
    } catch (error) {
      console.error(`Failed to save job ${job.jobId} to S3:`, error);
    }
  }

  /**
   * 從 S3 刪除過期的 jobs
   */
  private async cleanupOldJobsFromS3(): Promise<void> {
    try {
      const { ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      
      const listCommand = new ListObjectsV2Command({
        Bucket: s3BucketName,
        Prefix: 'jobs/',
      });

      const listResponse = await s3Client.send(listCommand);
      
      if (!listResponse.Contents) return;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.JOB_RETENTION_DAYS);

      let deletedCount = 0;

      for (const item of listResponse.Contents) {
        if (!item.Key || !item.LastModified) continue;

        if (item.LastModified < cutoffDate) {
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: s3BucketName,
              Key: item.Key,
            }));
            deletedCount++;
          } catch (error) {
            console.error(`Failed to delete old job ${item.Key}:`, error);
          }
        }
      }

      if (deletedCount > 0) {
        console.log(`✓ Cleaned up ${deletedCount} old jobs from S3`);
      }
    } catch (error) {
      console.error('Error cleaning up old jobs from S3:', error);
    }
  }
}


// 單例
export const vectorIndexService = new VectorIndexService();
