export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  s3Key: string;
  uploadedAt: Date;
  size: number;
  contentType: string;
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
