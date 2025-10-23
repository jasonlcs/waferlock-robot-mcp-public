import { ManualContent, UploadedFile } from '../types.js';

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
