import { QAEntry } from '../types';

export interface QAProvider {
  listEntries(filter?: { category?: string; search?: string }): Promise<QAEntry[]>;
  listQA(filter?: { category?: string; search?: string }): Promise<QAEntry[]>;
  getEntryById(id: string): Promise<QAEntry | undefined>;
  getQAById(id: string): Promise<QAEntry | undefined>;
  searchEntries(query: string): Promise<QAEntry[]>;
  intelligentSearch(query: string, limit?: number): Promise<QAEntry[]>;
}

/**
 * 公開版 CLI 不支援直接連線內部 QA 服務，提供預設的錯誤回應實作。
 */
export function createS3QAProvider(): QAProvider {
  const unsupported = async () => {
    throw new Error('S3 QA provider is not available in waferlock-robot-mcp-public.');
  };

  return {
    listEntries: unsupported,
    listQA: unsupported,
    getEntryById: unsupported,
    getQAById: unsupported,
    searchEntries: unsupported,
    intelligentSearch: unsupported,
  };
}
