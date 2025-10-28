import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import XLSX from 'xlsx';
import { QAEntry } from '../types';
import {
  hasAwsCredentials,
  s3BucketName,
  s3Client,
  s3MetadataPrefix,
} from './awsConfig';
import { streamToString } from '../utils/streamHelpers';

interface QAInput {
  category: string;
  question: string;
  answer: string;
}

interface QAListFilter {
  category?: string;
  search?: string;
}

export interface QAImportError {
  row: number;
  message: string;
}

export interface QAImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: QAImportError[];
}

class QAService {
  private entries: Map<string, QAEntry> = new Map();
  private metadataKey: string;
  private useLocalFile: boolean;
  private storageFile?: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.metadataKey = `${s3MetadataPrefix}/qa.json`;
    this.useLocalFile = !hasAwsCredentials;

    if (this.useLocalFile) {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.storageFile = path.join(dataDir, 'qa.json');
      this.loadEntriesFromDisk();
      this.initialized = true;
    }
  }

  async listEntries(filter?: QAListFilter): Promise<QAEntry[]> {
    await this.ensureInitialized();

    let entries = Array.from(this.entries.values());

    if (filter?.category) {
      const category = filter.category.toLowerCase();
      entries = entries.filter((entry) => entry.category.toLowerCase() === category);
    }

    if (filter?.search) {
      const query = filter.search.toLowerCase();
      entries = entries.filter(
        (entry) =>
          entry.question.toLowerCase().includes(query) ||
          entry.answer.toLowerCase().includes(query) ||
          entry.category.toLowerCase().includes(query)
      );
    }

    return entries.map((entry) => ({ ...entry }));
  }

  async searchEntries(query: string): Promise<QAEntry[]> {
    return this.listEntries({ search: query });
  }

  /**
   * 智能搜尋 - 根據相關性評分排序
   * 用於客服機器人場景，需要最相關的結果優先
   */
  async intelligentSearch(query: string, limit: number = 5): Promise<QAEntry[]> {
    await this.ensureInitialized();

    const normalizedQuery = query.toLowerCase();
    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);

    // 計算每個 entry 的相關性分數
    const scored = Array.from(this.entries.values()).map(entry => {
      let score = 0;

      // 精確短語匹配 (最高分)
      if (
        entry.question.toLowerCase().includes(normalizedQuery) ||
        entry.answer.toLowerCase().includes(normalizedQuery)
      ) {
        score += 10;
      }

      // 問題中的關鍵字匹配
      for (const word of queryWords) {
        if (entry.question.toLowerCase().includes(word)) {
          score += 3;
        }
        if (entry.answer.toLowerCase().includes(word)) {
          score += 2;
        }
        if (entry.category.toLowerCase().includes(word)) {
          score += 1;
        }
      }

      // 多個關鍵字都匹配的加分
      const matchingWords = queryWords.filter(
        w => entry.question.toLowerCase().includes(w) ||
             entry.answer.toLowerCase().includes(w)
      );
      score += matchingWords.length * 0.5;

      return { entry, score };
    });

    // 篩選和排序
    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => ({ ...item.entry }));
  }

  async getEntryById(id: string): Promise<QAEntry | undefined> {
    await this.ensureInitialized();
    const entry = this.entries.get(id);
    return entry ? { ...entry } : undefined;
  }

  async createEntry(input: QAInput): Promise<QAEntry> {
    await this.ensureInitialized();

    const now = new Date();
    const entry: QAEntry = {
      id: randomUUID(),
      category: input.category.trim(),
      question: input.question.trim(),
      answer: input.answer.trim(),
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(entry.id, entry);
    await this.persistEntries();
    return { ...entry };
  }

  async updateEntry(id: string, updates: Partial<QAInput>): Promise<QAEntry | undefined> {
    await this.ensureInitialized();

    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }

    let changed = false;

    if (typeof updates.category === 'string') {
      const trimmed = updates.category.trim();
      if (trimmed && trimmed !== entry.category) {
        entry.category = trimmed;
        changed = true;
      }
    }

    if (typeof updates.question === 'string') {
      const trimmed = updates.question.trim();
      if (trimmed && trimmed !== entry.question) {
        entry.question = trimmed;
        changed = true;
      }
    }

    if (typeof updates.answer === 'string') {
      const trimmed = updates.answer.trim();
      if (trimmed && trimmed !== entry.answer) {
        entry.answer = trimmed;
        changed = true;
      }
    }

    if (changed) {
      entry.updatedAt = new Date();
      await this.persistEntries();
    }

    return { ...entry };
  }

  async deleteEntry(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const deleted = this.entries.delete(id);

    if (deleted) {
      await this.persistEntries();
    }

    return deleted;
  }

  async exportEntriesAsXlsx(): Promise<Buffer> {
    await this.ensureInitialized();

    const rows = Array.from(this.entries.values()).map((entry) => ({
      id: entry.id,
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ['id', 'category', 'question', 'answer', 'createdAt', 'updatedAt'],
    });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'QA Entries');

    return XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
      compression: true,
    }) as Buffer;
  }

  async importEntriesFromXlsx(buffer: Buffer): Promise<QAImportResult> {
    await this.ensureInitialized();

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const [firstSheetName] = workbook.SheetNames;

    if (!firstSheetName) {
      throw new Error('Workbook contains no sheets');
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '',
      raw: false,
    });

    const result: QAImportResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    let mutated = false;

    rows.forEach((rawRow, index) => {
      const normalisedRow = this.normaliseSheetRow(rawRow);
      const rowNumber = index + 2; // account for header row

      const category = this.normaliseCellString(normalisedRow.category);
      const question = this.normaliseCellString(normalisedRow.question);
      const answer = this.normaliseCellString(normalisedRow.answer);

      if (!category && !question && !answer) {
        result.skipped += 1;
        return;
      }

      if (!category || !question || !answer) {
        result.skipped += 1;
        result.errors.push({
          row: rowNumber,
          message: 'Missing category, question, or answer',
        });
        return;
      }

      const parsedId = this.normaliseCellString(normalisedRow.id);
      const targetId = parsedId || undefined;
      const existing = targetId ? this.entries.get(targetId) : undefined;

      if (existing) {
        const needsUpdate =
          existing.category !== category ||
          existing.question !== question ||
          existing.answer !== answer;

        if (!needsUpdate) {
          result.skipped += 1;
          return;
        }

        existing.category = category;
        existing.question = question;
        existing.answer = answer;

        const importedUpdatedAt = this.parseDateValue(normalisedRow.updatedAt) ?? new Date();
        existing.updatedAt = importedUpdatedAt;

        result.updated += 1;
        mutated = true;
        return;
      }

      const now = new Date();
      const createdAt = this.parseDateValue(normalisedRow.createdAt) ?? now;
      const updatedAt = this.parseDateValue(normalisedRow.updatedAt) ?? createdAt;

      const id = targetId ?? randomUUID();

      if (this.entries.has(id)) {
        result.skipped += 1;
        result.errors.push({ row: rowNumber, message: `Duplicate ID '${id}'` });
        return;
      }

      const entry: QAEntry = {
        id,
        category,
        question,
        answer,
        createdAt,
        updatedAt,
      };

      this.entries.set(entry.id, entry);
      result.created += 1;
      mutated = true;
    });

    if (mutated) {
      await this.persistEntries();
    }

    return result;
  }

  private normaliseSheetRow(row: Record<string, unknown>): {
    id?: unknown;
    category?: unknown;
    question?: unknown;
    answer?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  } {
    const normalised: Record<string, unknown> = {};

    Object.entries(row).forEach(([key, value]) => {
      const trimmedKey = typeof key === 'string' ? key.trim().toLowerCase() : key;

      if (typeof trimmedKey === 'string') {
        normalised[trimmedKey] = value;
      }
    });

    return {
      id: normalised.id,
      category: normalised.category,
      question: normalised.question,
      answer: normalised.answer,
      createdAt: normalised.createdat,
      updatedAt: normalised.updatedat,
    };
  }

  private normaliseCellString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    const stringified = String(value).trim();
    return stringified;
  }

  private parseDateValue(value: unknown): Date | undefined {
    if (!value && value !== 0) {
      return undefined;
    }

    if (value instanceof Date) {
      return value;
    }

    const stringValue = String(value).trim();
    if (!stringValue) {
      return undefined;
    }

    const parsed = new Date(stringValue);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    const numeric = Number(stringValue);
    if (Number.isFinite(numeric)) {
      const excelDate = XLSX.SSF.parse_date_code?.(numeric);
      if (excelDate) {
        return new Date(
          Date.UTC(
            excelDate.y,
            (excelDate.m ?? 1) - 1,
            excelDate.d ?? 1,
            excelDate.H ?? 0,
            excelDate.M ?? 0,
            excelDate.S ?? 0
          )
        );
      }
    }

    return undefined;
  }

  private loadEntriesFromDisk(): void {
    if (!this.storageFile) {
      return;
    }

    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf-8');
        const entriesArray: QAEntry[] = JSON.parse(raw);

        entriesArray.forEach((entry) => {
          entry.createdAt = new Date(entry.createdAt);
          entry.updatedAt = entry.updatedAt ? new Date(entry.updatedAt) : entry.createdAt;
          this.entries.set(entry.id, entry);
        });

        console.log(`Loaded ${entriesArray.length} QA entries from local storage`);
      }
    } catch (error) {
      console.error('Error loading QA entries from disk:', error);
    }
  }

  private saveEntriesToDisk(): void {
    if (!this.storageFile) {
      return;
    }

    try {
      const payload = this.serialiseEntries();
      fs.writeFileSync(this.storageFile, payload);
    } catch (error) {
      console.error('Error saving QA entries to disk:', error);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.useLocalFile || this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.loadEntriesFromS3()
        .catch((error) => {
          console.error('Error loading QA entries from S3 metadata:', error);
          throw error;
        })
        .finally(() => {
          this.initialized = true;
        });
    }

    await this.initPromise;
  }

  private async loadEntriesFromS3(): Promise<void> {
    if (!hasAwsCredentials) {
      this.entries.clear();
      return;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: this.metadataKey,
      });

      const response = await s3Client.send(command);
      const body = await streamToString(response.Body as any);
      const entriesArray: QAEntry[] = JSON.parse(body);

      entriesArray.forEach((entry) => {
        entry.createdAt = new Date(entry.createdAt);
        entry.updatedAt = entry.updatedAt ? new Date(entry.updatedAt) : entry.createdAt;
        this.entries.set(entry.id, entry);
      });

      console.log(`Loaded ${entriesArray.length} QA entries from S3 metadata`);
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
        console.log('No existing QA metadata found in S3. Starting fresh.');
        this.entries.clear();
        return;
      }

      throw error;
    }
  }

  private async persistEntries(): Promise<void> {
    if (this.useLocalFile) {
      this.saveEntriesToDisk();
      return;
    }

    if (!hasAwsCredentials) {
      return;
    }

    const payload = this.serialiseEntries();
    const command = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: this.metadataKey,
      Body: payload,
      ContentType: 'application/json',
    });

    await s3Client.send(command);
  }

  private serialiseEntries(): string {
    const entriesArray = Array.from(this.entries.values()).map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    }));

    return JSON.stringify(entriesArray, null, 2);
  }
}

export const qaService = new QAService();
