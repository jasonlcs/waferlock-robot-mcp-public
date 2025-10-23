import { QAEntry } from '../types.js';

export interface QAProvider {
  listEntries(filter?: { category?: string; search?: string }): Promise<QAEntry[]>;
  getEntryById(id: string): Promise<QAEntry | undefined>;
  searchEntries(query: string): Promise<QAEntry[]>;
}
