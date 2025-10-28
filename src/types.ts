export enum TokenScope {
  FilesRead = 'files:read',
  FilesWrite = 'files:write',
  McpAccess = 'mcp:access',
  QaRead = 'qa:read',
  QaManage = 'qa:manage',
}

export const ALL_TOKEN_SCOPES: TokenScope[] = [
  TokenScope.FilesRead,
  TokenScope.FilesWrite,
  TokenScope.McpAccess,
  TokenScope.QaRead,
  TokenScope.QaManage,
];

export interface Token {
  id: string;
  token: string;
  name: string;
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  scopes: TokenScope[];
}

export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  s3Key: string;
  uploadedAt: Date;
  size: number;
  contentType: string;
  pdfPassword?: string;
  indexed?: boolean;
  indexManifest?: any;
  indexError?: string;
  // Lambda 索引狀態
  indexStatus?: 'pending' | 'completed' | 'failed';
  indexStartedAt?: string;
  indexCompletedAt?: string;
  indexKey?: string;
  metadataKey?: string;
  numChunks?: number;
  numVectors?: number;
}

export interface ManualContent {
  file: UploadedFile;
  contentBase64: string;
}

export interface QAEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  createdAt: Date;
  updatedAt: Date;
}
