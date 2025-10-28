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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetadataStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class MetadataStore {
    constructor() {
        this.metadata = new Map();
        this.filePath = null;
    }
    /**
     * 添加 metadata
     */
    add(vectorId, metadata) {
        this.metadata.set(vectorId, metadata);
    }
    /**
     * 批次添加 metadata
     */
    addBatch(items) {
        for (const { vectorId, metadata } of items) {
            this.metadata.set(vectorId, metadata);
        }
    }
    /**
     * 取得 metadata
     */
    get(vectorId) {
        return this.metadata.get(vectorId);
    }
    /**
     * 批次取得 metadata
     */
    getBatch(vectorIds) {
        return vectorIds
            .map(id => this.metadata.get(id))
            .filter((m) => m !== undefined);
    }
    /**
     * 儲存到 JSON Lines 檔案
     */
    save(filePath) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        console.log(`Saving metadata to ${filePath} (${this.metadata.size} entries)...`);
        // 使用 JSON Lines 格式 (每行一個 JSON 物件)
        const lines = [];
        for (const [vectorId, metadata] of this.metadata.entries()) {
            const entry = {
                ...metadata,
                vectorId,
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
    load(filePath) {
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
            }
            catch (error) {
                console.error('Failed to parse metadata line:', error);
            }
        }
        this.filePath = filePath;
        console.log(`Loaded ${this.metadata.size} metadata entries`);
    }
    /**
     * 搜尋 metadata (簡單文字搜尋)
     */
    search(query) {
        const lowerQuery = query.toLowerCase();
        const results = [];
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
    getAll() {
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
    clear() {
        this.metadata.clear();
        this.filePath = null;
    }
    /**
     * 取得檔案大小
     */
    getFileSize() {
        if (!this.filePath || !fs.existsSync(this.filePath)) {
            return 0;
        }
        const stats = fs.statSync(this.filePath);
        return stats.size;
    }
}
exports.MetadataStore = MetadataStore;
