import { UploadedFile } from '../types.js';

export interface ManualProvider {
  listManuals(): Promise<UploadedFile[]>;
  getManualById(id: string): Promise<UploadedFile | undefined>;
}
