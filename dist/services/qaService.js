"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.qaService = void 0;
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_s3_1 = require("@aws-sdk/client-s3");
const xlsx_1 = __importDefault(require("xlsx"));
const awsConfig_1 = require("./awsConfig");
const streamHelpers_1 = require("../utils/streamHelpers");
class QAService {
    constructor() {
        this.entries = new Map();
        this.initialized = false;
        this.initPromise = null;
        this.metadataKey = `${awsConfig_1.s3MetadataPrefix}/qa.json`;
        this.useLocalFile = !awsConfig_1.hasAwsCredentials;
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
    async listEntries(filter) {
        await this.ensureInitialized();
        let entries = Array.from(this.entries.values());
        if (filter?.category) {
            const category = filter.category.toLowerCase();
            entries = entries.filter((entry) => entry.category.toLowerCase() === category);
        }
        if (filter?.search) {
            const query = filter.search.toLowerCase();
            entries = entries.filter((entry) => entry.question.toLowerCase().includes(query) ||
                entry.answer.toLowerCase().includes(query) ||
                entry.category.toLowerCase().includes(query));
        }
        return entries.map((entry) => ({ ...entry }));
    }
    async searchEntries(query) {
        return this.listEntries({ search: query });
    }
    /**
     * 智能搜尋 - 根據相關性評分排序
     * 用於客服機器人場景，需要最相關的結果優先
     */
    async intelligentSearch(query, limit = 5) {
        await this.ensureInitialized();
        const normalizedQuery = query.toLowerCase();
        const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
        // 計算每個 entry 的相關性分數
        const scored = Array.from(this.entries.values()).map(entry => {
            let score = 0;
            // 精確短語匹配 (最高分)
            if (entry.question.toLowerCase().includes(normalizedQuery) ||
                entry.answer.toLowerCase().includes(normalizedQuery)) {
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
            const matchingWords = queryWords.filter(w => entry.question.toLowerCase().includes(w) ||
                entry.answer.toLowerCase().includes(w));
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
    async getEntryById(id) {
        await this.ensureInitialized();
        const entry = this.entries.get(id);
        return entry ? { ...entry } : undefined;
    }
    async createEntry(input) {
        await this.ensureInitialized();
        const now = new Date();
        const entry = {
            id: crypto_1.randomUUID(),
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
    async updateEntry(id, updates) {
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
    async deleteEntry(id) {
        await this.ensureInitialized();
        const deleted = this.entries.delete(id);
        if (deleted) {
            await this.persistEntries();
        }
        return deleted;
    }
    async exportEntriesAsXlsx() {
        await this.ensureInitialized();
        const rows = Array.from(this.entries.values()).map((entry) => ({
            id: entry.id,
            category: entry.category,
            question: entry.question,
            answer: entry.answer,
            createdAt: entry.createdAt.toISOString(),
            updatedAt: entry.updatedAt.toISOString(),
        }));
        const workbook = xlsx_1.default.utils.book_new();
        const worksheet = xlsx_1.default.utils.json_to_sheet(rows, {
            header: ['id', 'category', 'question', 'answer', 'createdAt', 'updatedAt'],
        });
        xlsx_1.default.utils.book_append_sheet(workbook, worksheet, 'QA Entries');
        return xlsx_1.default.write(workbook, {
            bookType: 'xlsx',
            type: 'buffer',
            compression: true,
        });
    }
    async importEntriesFromXlsx(buffer) {
        await this.ensureInitialized();
        const workbook = xlsx_1.default.read(buffer, { type: 'buffer' });
        const [firstSheetName] = workbook.SheetNames;
        if (!firstSheetName) {
            throw new Error('Workbook contains no sheets');
        }
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = xlsx_1.default.utils.sheet_to_json(worksheet, {
            defval: '',
            raw: false,
        });
        const result = {
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
                const needsUpdate = existing.category !== category ||
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
            const id = targetId ?? crypto_1.randomUUID();
            if (this.entries.has(id)) {
                result.skipped += 1;
                result.errors.push({ row: rowNumber, message: `Duplicate ID '${id}'` });
                return;
            }
            const entry = {
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
    normaliseSheetRow(row) {
        const normalised = {};
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
    normaliseCellString(value) {
        if (value === null || value === undefined) {
            return '';
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        const stringified = String(value).trim();
        return stringified;
    }
    parseDateValue(value) {
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
            const excelDate = xlsx_1.default.SSF.parse_date_code?.(numeric);
            if (excelDate) {
                return new Date(Date.UTC(excelDate.y, (excelDate.m ?? 1) - 1, excelDate.d ?? 1, excelDate.H ?? 0, excelDate.M ?? 0, excelDate.S ?? 0));
            }
        }
        return undefined;
    }
    loadEntriesFromDisk() {
        if (!this.storageFile) {
            return;
        }
        try {
            if (fs.existsSync(this.storageFile)) {
                const raw = fs.readFileSync(this.storageFile, 'utf-8');
                const entriesArray = JSON.parse(raw);
                entriesArray.forEach((entry) => {
                    entry.createdAt = new Date(entry.createdAt);
                    entry.updatedAt = entry.updatedAt ? new Date(entry.updatedAt) : entry.createdAt;
                    this.entries.set(entry.id, entry);
                });
                console.log(`Loaded ${entriesArray.length} QA entries from local storage`);
            }
        }
        catch (error) {
            console.error('Error loading QA entries from disk:', error);
        }
    }
    saveEntriesToDisk() {
        if (!this.storageFile) {
            return;
        }
        try {
            const payload = this.serialiseEntries();
            fs.writeFileSync(this.storageFile, payload);
        }
        catch (error) {
            console.error('Error saving QA entries to disk:', error);
        }
    }
    async ensureInitialized() {
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
    async loadEntriesFromS3() {
        if (!awsConfig_1.hasAwsCredentials) {
            this.entries.clear();
            return;
        }
        try {
            const command = new client_s3_1.GetObjectCommand({
                Bucket: awsConfig_1.s3BucketName,
                Key: this.metadataKey,
            });
            const response = await awsConfig_1.s3Client.send(command);
            const body = await streamHelpers_1.streamToString(response.Body);
            const entriesArray = JSON.parse(body);
            entriesArray.forEach((entry) => {
                entry.createdAt = new Date(entry.createdAt);
                entry.updatedAt = entry.updatedAt ? new Date(entry.updatedAt) : entry.createdAt;
                this.entries.set(entry.id, entry);
            });
            console.log(`Loaded ${entriesArray.length} QA entries from S3 metadata`);
        }
        catch (error) {
            if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
                console.log('No existing QA metadata found in S3. Starting fresh.');
                this.entries.clear();
                return;
            }
            throw error;
        }
    }
    async persistEntries() {
        if (this.useLocalFile) {
            this.saveEntriesToDisk();
            return;
        }
        if (!awsConfig_1.hasAwsCredentials) {
            return;
        }
        const payload = this.serialiseEntries();
        const command = new client_s3_1.PutObjectCommand({
            Bucket: awsConfig_1.s3BucketName,
            Key: this.metadataKey,
            Body: payload,
            ContentType: 'application/json',
        });
        await awsConfig_1.s3Client.send(command);
    }
    serialiseEntries() {
        const entriesArray = Array.from(this.entries.values()).map((entry) => ({
            ...entry,
            createdAt: entry.createdAt.toISOString(),
            updatedAt: entry.updatedAt.toISOString(),
        }));
        return JSON.stringify(entriesArray, null, 2);
    }
}
exports.qaService = new QAService();
