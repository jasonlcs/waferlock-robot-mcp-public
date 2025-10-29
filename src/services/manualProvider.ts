import { ManualContent, UploadedFile } from '../types';

export interface ManualProvider {
  listManuals(): Promise<UploadedFile[]>;
  getManualById(id: string): Promise<UploadedFile | undefined>;
  getManualDownloadUrl?(
    id: string,
    options?: ManualDownloadOptions
  ): Promise<string | undefined>;
  getManualContent?(id: string): Promise<ManualContent | undefined>;
}

export interface ManualDownloadOptions {
  expiresInSeconds?: number;
}

/**
 * Public CLI 目前不支援直接存取 S3，因此提供退回錯誤的預設實作，
 * 避免在沒有 API provider 的情況下呼叫而造成不可預期行為。
 */
export function createS3ManualProvider(): ManualProvider {
  const unsupported = async () => {
    throw new Error('S3 manual provider is not available in waferlock-robot-mcp-public.');
  };

  return {
    listManuals: unsupported,
    getManualById: unsupported,
    getManualDownloadUrl: unsupported,
    getManualContent: unsupported as (id: string) => Promise<ManualContent | undefined>,
  };
}
