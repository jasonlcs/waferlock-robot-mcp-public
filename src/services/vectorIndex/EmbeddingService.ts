import OpenAI from 'openai';

// Lazy initialization to avoid requiring API key at module load time
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  totalTokens: number;
}

export class EmbeddingService {
  private model: string;
  private dimensions: number;
  private maxRetries: number;
  private retryDelay: number;

  constructor(
    model: string = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    dimensions: number = parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '512'),
    maxRetries: number = 3
  ) {
    this.model = model;
    this.dimensions = dimensions;
    this.maxRetries = maxRetries;
    this.retryDelay = 1000; // 1 秒
  }

  /**
   * 生成單個文字的 embedding
   */
  async embedText(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result.embeddings[0];
  }

  /**
   * 批次生成 embeddings
   * @param texts 文字陣列
   * @returns EmbeddingResult
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        model: this.model,
        dimensions: this.dimensions,
        totalTokens: 0,
      };
    }

    // 清理文字 (移除過長空白、換行)
    const cleanedTexts = texts.map(t => this.cleanText(t));

    let lastError: Error | null = null;

    // 重試邏輯
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        console.log(`Embedding batch of ${texts.length} texts (attempt ${attempt + 1}/${this.maxRetries})`);

        const response = await getOpenAIClient().embeddings.create({
          model: this.model,
          input: cleanedTexts,
          dimensions: this.dimensions,
        });

        const embeddings = response.data.map(item => item.embedding);
        const totalTokens = response.usage.total_tokens;

        console.log(`Successfully embedded ${embeddings.length} texts, used ${totalTokens} tokens`);

        return {
          embeddings,
          model: this.model,
          dimensions: this.dimensions,
          totalTokens,
        };
      } catch (error: any) {
        lastError = error;
        console.error(`Embedding attempt ${attempt + 1} failed:`, error.message);

        // 檢查是否為 rate limit 錯誤
        if (error.status === 429) {
          const waitTime = this.retryDelay * Math.pow(2, attempt); // 指數退避
          console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
          continue;
        }

        // 檢查是否為網路錯誤
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          console.log(`Network error, retrying in ${this.retryDelay}ms...`);
          await this.sleep(this.retryDelay);
          continue;
        }

        // 其他錯誤直接拋出
        throw new Error(`OpenAI API error: ${error.message}`);
      }
    }

    throw new Error(`Failed to generate embeddings after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * 估算 token 數量 (粗略估算)
   */
  estimateTokens(text: string): number {
    // 簡單估算: 1 token ≈ 4 字符
    return Math.ceil(text.length / 4);
  }

  /**
   * 清理文字
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // 多個空白合併為一個
      .replace(/\n+/g, ' ') // 換行轉為空白
      .trim()
      .substring(0, 8000); // 限制最大長度
  }

  /**
   * 延遲函數
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 計算餘弦相似度
   */
  static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * 驗證 API Key
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.embedText('test');
      return true;
    } catch (error) {
      console.error('OpenAI API key validation failed:', error);
      return false;
    }
  }
}

// 單例
export const embeddingService = new EmbeddingService();
