import { ManualContent, UploadedFile } from '../types.js';

export interface VectorSearchResult {
  chunkId: string;
  fileId: string;
  content: string;
  score: number;
  metadata: {
    chunkId: string;
    fileId: string;
    vectorId: number;
    content: string;
    startIndex: number;
    endIndex: number;
    chunkOrder: number;
    createdAt: string;
  };
}

export interface ManualProvider {
  listManuals(): Promise<UploadedFile[]>;
  getManualById(id: string): Promise<UploadedFile | undefined>;
  getManualDownloadUrl?(
    id: string,
    options?: ManualDownloadOptions
  ): Promise<string | undefined>;
  getManualContent?(id: string): Promise<ManualContent | undefined>;
  searchManualVector?(
    fileId: string,
    query: string,
    k?: number,
    minScore?: number
  ): Promise<VectorSearchResult[]>;
}

export interface ManualDownloadOptions {
  expiresInSeconds?: number;
}
