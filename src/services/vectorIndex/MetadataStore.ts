import * as fs from 'fs';
import * as path from 'path';
import { VectorMetadata } from '../../types/vectorIndex';

export class MetadataStore {
  private metadata: Map<number, VectorMetadata> = new Map();
  private filePath: string | null = null;

  /**
   * 添加 metadata
   */
  add(vectorId: number, metadata: VectorMetadata): void {
    this.metadata.set(vectorId, metadata);
  }

  /**
   * 批次添加 metadata
   */
  addBatch(items: { vectorId: number; metadata: VectorMetadata }[]): void {
    for (const { vectorId, metadata } of items) {
      this.metadata.set(vectorId, metadata);
    }
  }

  /**
   * 取得 metadata
   */
  get(vectorId: number): VectorMetadata | undefined {
    return this.metadata.get(vectorId);
  }

  /**
   * 批次取得 metadata
   */
  getBatch(vectorIds: number[]): VectorMetadata[] {
    return vectorIds
      .map(id => this.metadata.get(id))
      .filter((m): m is VectorMetadata => m !== undefined);
  }

  /**
   * 儲存到 JSON Lines 檔案
   */
  save(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    console.log(`Saving metadata to ${filePath} (${this.metadata.size} entries)...`);

    // 使用 JSON Lines 格式 (每行一個 JSON 物件)
    const lines: string[] = [];
    for (const [vectorId, metadata] of this.metadata.entries()) {
      const entry = {
        vectorId,
        ...metadata,
        createdAt: metadata.createdAt.toISOString(),
      };
      lines.push(JSON.stringify(entry));
    }

    fs.writeFileSync(filePath, lines.join('\n'));
    this.filePath = filePath;

    const stats = fs.statSync(filePath);
    console.log(`Metadata saved: ${(stats.size / 1024).toFixed(2)} KB`);
  }

  /**
   * 從 JSON Lines 檔案載入
   */
  load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Metadata file not found: ${filePath}`);
    }

    console.log(`Loading metadata from ${filePath}...`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    this.metadata.clear();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const { vectorId, ...metadata } = entry;

        this.metadata.set(vectorId, {
          ...metadata,
          createdAt: new Date(metadata.createdAt),
        });
      } catch (error) {
        console.error('Failed to parse metadata line:', error);
      }
    }

    this.filePath = filePath;
    console.log(`Loaded ${this.metadata.size} metadata entries`);
  }

  /**
   * 搜尋 metadata (簡單文字搜尋)
   */
  search(query: string): VectorMetadata[] {
    const lowerQuery = query.toLowerCase();
    const results: VectorMetadata[] = [];

    for (const metadata of this.metadata.values()) {
      if (metadata.content.toLowerCase().includes(lowerQuery)) {
        results.push(metadata);
      }
    }

    return results;
  }

  /**
   * 取得所有 metadata
   */
  getAll(): VectorMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * 取得統計資訊
   */
  getStats() {
    let totalContentLength = 0;
    for (const metadata of this.metadata.values()) {
      totalContentLength += metadata.content.length;
    }

    return {
      totalEntries: this.metadata.size,
      avgContentLength: this.metadata.size > 0 ? Math.round(totalContentLength / this.metadata.size) : 0,
      filePath: this.filePath,
    };
  }

  /**
   * 清理
   */
  clear(): void {
    this.metadata.clear();
    this.filePath = null;
  }

  /**
   * 取得檔案大小
   */
  getFileSize(): number {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return 0;
    }

    const stats = fs.statSync(this.filePath);
    return stats.size;
  }
}
