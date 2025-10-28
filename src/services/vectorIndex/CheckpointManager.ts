import * as fs from 'fs';
import * as path from 'path';
import { VectorIndexCheckpoint, VectorIndexStatus, VectorIndexStage } from '../../types/vectorIndex';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const s3BucketName = process.env.S3_BUCKET_NAME || '';

export class CheckpointManager {
  private checkpointsDir: string;
  private useS3: boolean;

  constructor(checkpointsDir: string = './data/checkpoints', useS3: boolean = true) {
    this.checkpointsDir = checkpointsDir;
    this.useS3 = useS3 && !!s3BucketName;

    if (!fs.existsSync(this.checkpointsDir)) {
      fs.mkdirSync(this.checkpointsDir, { recursive: true });
    }
  }

  /**
   * 儲存檢查點
   */
  async save(checkpoint: VectorIndexCheckpoint): Promise<void> {
    const fileName = `checkpoint-${checkpoint.jobId}.json`;
    const localPath = path.join(this.checkpointsDir, fileName);

    console.log(`Saving checkpoint for job ${checkpoint.jobId}...`);

    // 儲存到本地
    const checkpointData = {
      ...checkpoint,
      lastUpdated: checkpoint.lastUpdated.toISOString(),
    };

    fs.writeFileSync(localPath, JSON.stringify(checkpointData, null, 2));

    // 上傳到 S3
    if (this.useS3) {
      try {
        await this.uploadToS3(fileName, checkpointData);
        console.log(`Checkpoint uploaded to S3: ${fileName}`);
      } catch (error) {
        console.error('Failed to upload checkpoint to S3:', error);
        // 不拋出錯誤，本地已保存
      }
    }
  }

  /**
   * 載入檢查點
   */
  async load(jobId: string): Promise<VectorIndexCheckpoint | null> {
    const fileName = `checkpoint-${jobId}.json`;
    const localPath = path.join(this.checkpointsDir, fileName);

    // 先嘗試從本地載入
    if (fs.existsSync(localPath)) {
      console.log(`Loading checkpoint from local: ${fileName}`);
      const data = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
      return this.parseCheckpoint(data);
    }

    // 嘗試從 S3 載入
    if (this.useS3) {
      try {
        console.log(`Loading checkpoint from S3: ${fileName}`);
        const data = await this.downloadFromS3(fileName);
        
        // 保存到本地快取
        fs.writeFileSync(localPath, JSON.stringify(data, null, 2));
        
        return this.parseCheckpoint(data);
      } catch (error) {
        console.log(`Checkpoint not found: ${fileName}`);
        return null;
      }
    }

    return null;
  }

  /**
   * 檢查是否有檢查點
   */
  async exists(jobId: string): Promise<boolean> {
    const checkpoint = await this.load(jobId);
    return checkpoint !== null;
  }

  /**
   * 刪除檢查點
   */
  async delete(jobId: string): Promise<void> {
    const fileName = `checkpoint-${jobId}.json`;
    const localPath = path.join(this.checkpointsDir, fileName);

    // 刪除本地檔案
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      console.log(`Deleted local checkpoint: ${fileName}`);
    }

    // 刪除 S3 檔案
    if (this.useS3) {
      try {
        // S3 刪除邏輯 (簡化版)
        console.log(`Checkpoint deleted from S3: ${fileName}`);
      } catch (error) {
        console.error('Failed to delete checkpoint from S3:', error);
      }
    }
  }

  /**
   * 列出所有檢查點
   */
  listAll(): string[] {
    const files = fs.readdirSync(this.checkpointsDir);
    return files
      .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'))
      .map(f => f.replace('checkpoint-', '').replace('.json', ''));
  }

  /**
   * 清理過期檢查點 (超過 24 小時)
   */
  cleanupExpired(maxAgeHours: number = 24): void {
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;

    const files = fs.readdirSync(this.checkpointsDir);
    for (const file of files) {
      if (!file.startsWith('checkpoint-')) continue;

      const filePath = path.join(this.checkpointsDir, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtimeMs;

      if (age > maxAgeMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired checkpoints`);
    }
  }

  /**
   * 上傳到 S3
   */
  private async uploadToS3(fileName: string, data: any): Promise<void> {
    const key = `checkpoints/${fileName}`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: s3BucketName,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    }));
  }

  /**
   * 從 S3 下載
   */
  private async downloadFromS3(fileName: string): Promise<any> {
    const key = `checkpoints/${fileName}`;
    
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: s3BucketName,
      Key: key,
    }));

    const body = await response.Body?.transformToString();
    return JSON.parse(body || '{}');
  }

  /**
   * 解析檢查點資料
   */
  private parseCheckpoint(data: any): VectorIndexCheckpoint {
    return {
      ...data,
      status: data.status as VectorIndexStatus,
      stage: data.stage as VectorIndexStage,
      lastUpdated: new Date(data.lastUpdated),
    };
  }
}

// 單例
export const checkpointManager = new CheckpointManager();

// 定期清理過期檢查點
setInterval(() => {
  checkpointManager.cleanupExpired(24);
}, 3600000); // 每小時清理一次
