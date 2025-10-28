/**
 * 向量索引系統型別定義
 */

export enum VectorIndexStatus {
  PENDING = 'pending',
  INITIALIZING = 'initializing',
  EXTRACTING = 'extracting',
  EMBEDDING = 'embedding',
  INDEXING = 'indexing',
  SAVING = 'saving',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum VectorIndexStage {
  INITIALIZATION = 'initialization',
  TEXT_EXTRACTION = 'text_extraction',
  EMBEDDING_GENERATION = 'embedding_generation',
  INDEX_BUILDING = 'index_building',
  METADATA_STORAGE = 'metadata_storage',
  S3_UPLOAD = 's3_upload',
  COMPLETED = 'completed',
}

export interface VectorIndexJob {
  jobId: string;
  fileId: string;
  fileName: string;
  status: VectorIndexStatus;
  stage: VectorIndexStage;
  progress: VectorIndexProgress;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  error?: string;
  checkpointUrl?: string;
  manifestUrl?: string;
  // Lambda 執行統計
  processingTime?: number;
  numChunks?: number;
  numVectors?: number;
  stats?: {
    download_time: number;
    extract_time: number;
    chunk_time: number;
    embed_time: number;
    index_time: number;
    upload_time: number;
    total_time: number;
  };
  costs?: {
    lambda: number;      // Lambda 執行費用 (USD)
    embedding: number;   // OpenAI Embedding API 費用 (USD)
    total: number;       // 總費用 (USD)
  };
}

export interface VectorIndexProgress {
  current: number;
  total: number;
  percentage: number;
  currentBatch?: number;
  totalBatches?: number;
  message?: string;
  eta?: number;
}

export interface VectorIndexCheckpoint {
  jobId: string;
  fileId: string;
  status: VectorIndexStatus;
  stage: VectorIndexStage;
  progress: VectorIndexProgress;
  processedChunkIds: string[];
  tempVectorFiles: string[];
  lastProcessedIndex: number;
  retryCount: number;
  lastUpdated: Date;
  error?: string;
}

export interface VectorIndexManifest {
  version: string;
  fileId: string;
  fileName: string;
  indexType: 'hnsw' | 'faiss-flat-ip';
  embeddingModel: string;
  dimensions: number;
  totalVectors: number;
  totalChunks: number;
  createdAt: Date;
  files: {
    index: string;
    metadata: string;
    manifest: string;
  };
  checksum: {
    index: string;
    metadata: string;
  };
}

export interface VectorMetadata {
  chunkId: string;
  fileId: string;
  vectorId: number;
  content: string;
  startIndex: number;
  endIndex: number;
  chunkOrder: number;
  createdAt: Date;
}

export interface VectorSearchResult {
  chunkId: string;
  fileId: string;
  content: string;
  score: number;
  metadata: VectorMetadata;
}

export interface VectorSearchRequest {
  fileId?: string;
  query: string;
  k?: number;
  minScore?: number;
}

export interface VectorIndexConfig {
  batchSize: number;
  maxChunksInMemory: number;
  maxVectorsInMemory: number;
  checkpointInterval: number;
  gcInterval: number;
  maxRetries: number;
  embeddingModel: string;
  dimensions: number;
  indexType: 'hnsw';
}
