import { QAEntry } from '../types';
import { qaService } from './qaService';

export interface QAProvider {
  listEntries(filter?: { category?: string; search?: string }): Promise<QAEntry[]>;
  listQA(filter?: { category?: string; search?: string }): Promise<QAEntry[]>;
  getEntryById(id: string): Promise<QAEntry | undefined>;
  getQAById(id: string): Promise<QAEntry | undefined>;
  searchEntries(query: string): Promise<QAEntry[]>;
  intelligentSearch(query: string, limit?: number): Promise<QAEntry[]>;
}

export function createS3QAProvider(): QAProvider {
  return {
    listEntries: (filter) => qaService.listEntries(filter),
    listQA: (filter) => qaService.listEntries(filter),
    getEntryById: (id: string) => qaService.getEntryById(id),
    getQAById: (id: string) => qaService.getEntryById(id),
    searchEntries: (query: string) => qaService.searchEntries(query),
    intelligentSearch: (query: string, limit?: number) => qaService.intelligentSearch(query, limit),
  };
}
