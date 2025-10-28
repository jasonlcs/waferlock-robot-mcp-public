/**
 * Lambda Indexer Service
 * 觸發 AWS Lambda 建立 PDF 向量索引
 */
import { s3Service } from './s3Service';

interface IndexingRequest {
  s3Bucket: string;
  s3Key: string;
  fileId: string;
  fileName: string;
  jobId?: string;
  callbackUrl: string;
}

class LambdaIndexerService {
  private lambdaUrl: string;

  constructor() {
    this.lambdaUrl = process.env.LAMBDA_INDEXER_URL || '';
    
    if (!this.lambdaUrl) {
      console.warn('⚠️ LAMBDA_INDEXER_URL not set - PDF indexing disabled');
    }
  }

  async triggerIndexing(fileId: string, fileName: string, s3Key: string, jobId?: string): Promise<boolean> {
    if (!this.lambdaUrl) {
      console.log('Lambda indexing disabled, skipping...');
      return false;
    }

    try {
      const s3Bucket = process.env.S3_BUCKET_NAME || 'waferlock-robot-mcp';
      const herokuDomain = process.env.HEROKU_APP_URL || 'https://waferlock-robot-mcp-1177c207c107.herokuapp.com';
      const callbackUrl = `${herokuDomain}/api/indexing-callback`;

      const payload: IndexingRequest = {
        s3Bucket,
        s3Key,
        fileId,
        fileName,
        jobId,
        callbackUrl
      };

      console.log(`Triggering Lambda indexing for ${fileName} (${fileId})`);
      console.log(`Lambda URL: ${this.lambdaUrl}`);
      console.log(`Callback URL: ${callbackUrl}`);
      if (jobId) {
        console.log(`Job ID: ${jobId}`);
      }

      // 更新狀態為 pending
      await s3Service.updateFileMetadata(fileId, {
        indexStatus: 'pending',
        indexStartedAt: new Date().toISOString()
      });

      // 呼叫 Lambda
      const response = await fetch(this.lambdaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log(`✓ Lambda triggered successfully for ${fileName}`);
        return true;
      } else {
        const errorText = await response.text();
        throw new Error(`Lambda returned status ${response.status}: ${errorText}`);
      }
    } catch (error: any) {
      console.error(`✗ Failed to trigger Lambda indexing:`, error.message);
      
      // 更新狀態為 failed
      await s3Service.updateFileMetadata(fileId, {
        indexStatus: 'failed',
        indexError: error.message
      });
      
      return false;
    }
  }
}

export const lambdaIndexerService = new LambdaIndexerService();
