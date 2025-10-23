export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  s3Key: string;
  uploadedAt: Date;
  size: number;
  contentType: string;
}
