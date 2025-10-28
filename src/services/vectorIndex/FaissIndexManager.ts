import { IndexFlatIP } from 'faiss-node';
import * as fs from 'fs';
import * as path from 'path';

export interface FaissSearchResult {
  labels: number[]; // 向量 ID
  distances: number[]; // 距離 (Inner Product)
}

export class FaissIndexManager {
  private index: IndexFlatIP | null = null;
  private dimensions: number;
  private vectorCount: number = 0;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  /**
   * 從檔案載入索引
   */
  async load(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Index file not found: ${filePath}`);
    }

    console.log(`Loading FAISS index from ${filePath}...`);

    this.index = await IndexFlatIP.read(filePath);
    this.vectorCount = this.index.ntotal();

    console.log(`Index loaded successfully (${this.vectorCount} vectors, ${this.dimensions} dimensions)`);
  }

  /**
   * 搜尋最近鄰
   */
  async search(queryVector: number[], k: number = 5): Promise<FaissSearchResult> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (queryVector.length !== this.dimensions) {
      throw new Error(
        `Query vector dimension mismatch: expected ${this.dimensions}, got ${queryVector.length}`
      );
    }

    if (this.vectorCount === 0) {
      return { labels: [], distances: [] };
    }

    // 確保 k 不超過向量總數
    const actualK = Math.min(k, this.vectorCount);

    // FAISS search 返回 { distances, labels }
    const result = this.index.search(queryVector, actualK);

    return {
      labels: result.labels,
      distances: result.distances,
    };
  }

  /**
   * 取得索引統計
   */
  getStats() {
    return {
      dimensions: this.dimensions,
      currentCount: this.vectorCount,
      isInitialized: this.index !== null,
    };
  }

  /**
   * 清理索引
   */
  clear(): void {
    if (this.index) {
      this.index = null;
    }
    this.vectorCount = 0;
  }
}
