import { HierarchicalNSW } from 'hnswlib-node';
import * as fs from 'fs';
import * as path from 'path';

export interface IndexConfig {
  dimensions: number;
  maxElements: number;
  m?: number; // HNSW 參數
  efConstruction?: number; // 建構時的 ef
  efSearch?: number; // 搜尋時的 ef
}

export interface SearchResult {
  neighbors: number[]; // 向量 ID
  distances: number[]; // 距離
}

export class HNSWIndexManager {
  private index: HierarchicalNSW | null = null;
  private config: IndexConfig;
  private vectorCount: number = 0;
  private indexPath: string | null = null;

  constructor(config: IndexConfig) {
    this.config = {
      ...config,
      m: config.m || 16,
      efConstruction: config.efConstruction || 200,
      efSearch: config.efSearch || 50,
    };
  }

  /**
   * 初始化索引
   */
  initialize(): void {
    if (this.index) {
      throw new Error('Index already initialized');
    }

    console.log(`Initializing HNSW index with dimensions=${this.config.dimensions}, maxElements=${this.config.maxElements}`);

    this.index = new HierarchicalNSW('cosine', this.config.dimensions);
    this.index.initIndex(this.config.maxElements, this.config.m, this.config.efConstruction);
    this.index.setEf(this.config.efSearch!);

    this.vectorCount = 0;
  }

  /**
   * 添加向量
   */
  addVector(id: number, vector: number[]): void {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (vector.length !== this.config.dimensions) {
      throw new Error(`Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`);
    }

    if (id >= this.config.maxElements) {
      throw new Error(`Vector ID ${id} exceeds maxElements ${this.config.maxElements}`);
    }

    this.index.addPoint(vector, id);
    this.vectorCount++;
  }

  /**
   * 批次添加向量
   */
  addVectors(vectors: { id: number; vector: number[] }[]): void {
    console.log(`Adding ${vectors.length} vectors to index...`);

    for (const { id, vector } of vectors) {
      this.addVector(id, vector);
    }

    console.log(`Successfully added ${vectors.length} vectors. Total count: ${this.vectorCount}`);
  }

  /**
   * 搜尋最近鄰
   */
  search(queryVector: number[], k: number = 5): SearchResult {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (queryVector.length !== this.config.dimensions) {
      throw new Error(`Query vector dimension mismatch: expected ${this.config.dimensions}, got ${queryVector.length}`);
    }

    if (this.vectorCount === 0) {
      return { neighbors: [], distances: [] };
    }

    // 確保 k 不超過向量總數
    const actualK = Math.min(k, this.vectorCount);

    const result = this.index.searchKnn(queryVector, actualK);

    return {
      neighbors: result.neighbors,
      distances: result.distances,
    };
  }

  /**
   * 儲存索引到檔案
   */
  save(filePath: string): void {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // 確保目錄存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    console.log(`Saving HNSW index to ${filePath}...`);
    this.index.writeIndexSync(filePath);
    this.indexPath = filePath;
    console.log(`Index saved successfully (${this.vectorCount} vectors)`);
  }

  /**
   * 從檔案載入索引
   */
  load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Index file not found: ${filePath}`);
    }

    console.log(`Loading HNSW index from ${filePath}...`);

    this.index = new HierarchicalNSW('cosine', this.config.dimensions);
    this.index.readIndexSync(filePath);
    this.index.setEf(this.config.efSearch!);

    this.vectorCount = this.index.getCurrentCount();
    this.indexPath = filePath;

    console.log(`Index loaded successfully (${this.vectorCount} vectors)`);
  }

  /**
   * 取得索引統計
   */
  getStats() {
    return {
      dimensions: this.config.dimensions,
      maxElements: this.config.maxElements,
      currentCount: this.vectorCount,
      m: this.config.m,
      efConstruction: this.config.efConstruction,
      efSearch: this.config.efSearch,
      indexPath: this.indexPath,
      isInitialized: this.index !== null,
    };
  }

  /**
   * 取得索引檔案大小
   */
  getIndexFileSize(): number {
    if (!this.indexPath || !fs.existsSync(this.indexPath)) {
      return 0;
    }

    const stats = fs.statSync(this.indexPath);
    return stats.size;
  }

  /**
   * 清理索引
   */
  clear(): void {
    if (this.index) {
      this.index = null;
    }
    this.vectorCount = 0;
    this.indexPath = null;
  }

  /**
   * 調整搜尋參數
   */
  setEfSearch(ef: number): void {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    this.config.efSearch = ef;
    this.index.setEf(ef);
    console.log(`Set efSearch to ${ef}`);
  }

  /**
   * 取得向量數量
   */
  getVectorCount(): number {
    return this.vectorCount;
  }

  /**
   * 驗證索引完整性
   */
  validate(): boolean {
    if (!this.index) {
      return false;
    }

    try {
      // 嘗試搜尋一個隨機向量
      const testVector = Array(this.config.dimensions).fill(0.1);
      this.search(testVector, 1);
      return true;
    } catch (error) {
      console.error('Index validation failed:', error);
      return false;
    }
  }
}
