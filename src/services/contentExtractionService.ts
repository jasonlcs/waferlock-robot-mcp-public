/**
 * Legacy Content Extraction Service (已棄用)
 * 
 * 此服務已移除 pdf-parse 依賴
 * 未來將由 AWS Lambda + 向量索引取代
 */

export interface TextChunk {
  id: string;
  fileId: string;
  content: string;
  startIndex: number;
  endIndex: number;
  chunkOrder: number;
  createdAt: Date;
}

export interface FileContent {
  fileId: string;
  fileName: string;
  chunks: TextChunk[];
  totalChunks: number;
  extractedAt: Date;
}

export class ContentExtractionService {
  /**
   * 已棄用：不再提取 PDF 文字
   * 改由 Lambda 處理
   */
  async processFile(
    filePath: string,
    fileId: string,
    fileName: string
  ): Promise<FileContent> {
    throw new Error('ContentExtractionService is deprecated. Use Lambda indexing instead.');
  }

  /**
   * 已棄用：簡易關鍵字搜尋
   */
  searchChunks(chunks: TextChunk[], query: string, limit: number = 5): TextChunk[] {
    const queryLower = query.toLowerCase();
    const scored = chunks
      .map((chunk) => {
        const contentLower = chunk.content.toLowerCase();
        const matchCount = (contentLower.match(new RegExp(queryLower, 'g')) || []).length;
        return { chunk, score: matchCount };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((item) => item.chunk);
  }
}

export const contentExtractionService = new ContentExtractionService();
