import { ManualContent, UploadedFile } from '../types';
import { s3Service } from './s3Service';

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

export function createS3ManualProvider(): ManualProvider {
  return {
    listManuals: () => s3Service.listFiles(),
    getManualById: (id: string) => s3Service.getFileById(id),
    getManualDownloadUrl: (id: string, options?: ManualDownloadOptions) =>
      s3Service.generateDownloadUrl(id, options),
    getManualContent: async (id: string) => {
      const result = await s3Service.downloadFileBuffer(id);
      if (!result) {
        return undefined;
      }
      return {
        file: result.file,
        contentBase64: result.buffer.toString('base64'),
      };
    },
  };
}
