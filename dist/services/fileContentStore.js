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
exports.fileContentStore = exports.FileContentStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class FileContentStore {
    constructor(useLocalStorage = true, dataDir = './data') {
        this.indexStore = new Map();
        this.useLocalStorage = useLocalStorage;
        this.dataDir = dataDir;
        if (this.useLocalStorage) {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            this.loadFromDisk();
        }
    }
    /**
     * 保存檔案內容（只保存索引在記憶體，完整內容存硬碟）
     */
    save(fileContent) {
        const index = {
            fileId: fileContent.fileId,
            fileName: fileContent.fileName,
            totalChunks: fileContent.totalChunks,
            extractedAt: fileContent.extractedAt,
            hasContent: true,
        };
        this.indexStore.set(fileContent.fileId, index);
        if (this.useLocalStorage) {
            this.saveToDisk(fileContent);
        }
    }
    /**
     * 取得檔案內容（從硬碟載入）
     */
    get(fileId) {
        const index = this.indexStore.get(fileId);
        if (!index || !index.hasContent) {
            return undefined;
        }
        if (this.useLocalStorage) {
            return this.loadFromDiskById(fileId);
        }
        return undefined;
    }
    /**
     * 刪除檔案內容
     */
    delete(fileId) {
        const deleted = this.indexStore.delete(fileId);
        if (this.useLocalStorage && deleted) {
            const filePath = this.getFilePath(fileId);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        return deleted;
    }
    /**
     * 檢查檔案是否存在
     */
    has(fileId) {
        return this.indexStore.has(fileId);
    }
    /**
     * 取得所有檔案索引（不載入完整內容）
     */
    getAll() {
        return Array.from(this.indexStore.values());
    }
    /**
     * 搜尋所有塊（按需載入）
     */
    searchAllChunks(query) {
        const results = new Map();
        const queryLower = query.toLowerCase();
        for (const index of this.indexStore.values()) {
            const content = this.get(index.fileId);
            if (!content)
                continue;
            const relevantChunks = content.chunks.filter(chunk => chunk.content.toLowerCase().includes(queryLower));
            if (relevantChunks.length > 0) {
                results.set(index.fileId, relevantChunks);
            }
        }
        return results;
    }
    /**
     * 私有方法：存到磁碟 (只儲存 chunks)
     */
    saveToDisk(fileContent) {
        try {
            const filePath = this.getFilePath(fileContent.fileId);
            // 只儲存 chunks，不儲存 fullText
            const serializable = {
                fileId: fileContent.fileId,
                fileName: fileContent.fileName,
                totalChunks: fileContent.totalChunks,
                extractedAt: fileContent.extractedAt.toISOString(),
                chunks: fileContent.chunks.map(c => ({
                    id: c.id,
                    fileId: c.fileId,
                    content: c.content,
                    startIndex: c.startIndex,
                    endIndex: c.endIndex,
                    chunkOrder: c.chunkOrder,
                    createdAt: c.createdAt.toISOString(),
                })),
            };
            const jsonStr = JSON.stringify(serializable);
            fs.writeFileSync(filePath, jsonStr);
        }
        catch (error) {
            console.error(`Failed to save file content to disk: ${error}`);
        }
    }
    /**
     * 私有方法：從磁碟載入（只載入索引）
     */
    loadFromDisk() {
        try {
            const files = fs.readdirSync(this.dataDir).filter(f => f.startsWith('content-'));
            for (const file of files) {
                try {
                    const filePath = path.join(this.dataDir, file);
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    const index = {
                        fileId: data.fileId,
                        fileName: data.fileName,
                        totalChunks: data.totalChunks,
                        extractedAt: new Date(data.extractedAt),
                        hasContent: true,
                    };
                    this.indexStore.set(index.fileId, index);
                }
                catch (error) {
                    console.warn(`Failed to load content file ${file}:`, error);
                }
            }
            console.log(`Loaded ${this.indexStore.size} file contents from disk`);
        }
        catch (error) {
            console.warn('Failed to load file contents from disk:', error);
        }
    }
    /**
     * 私有方法：從磁碟載入單一檔案
     */
    loadFromDiskById(fileId) {
        try {
            const filePath = this.getFilePath(fileId);
            if (!fs.existsSync(filePath)) {
                return undefined;
            }
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const fileContent = {
                fileId: data.fileId,
                fileName: data.fileName,
                chunks: data.chunks.map((c) => ({
                    id: c.id,
                    fileId: c.fileId,
                    content: c.content,
                    startIndex: c.startIndex,
                    endIndex: c.endIndex,
                    chunkOrder: c.chunkOrder,
                    createdAt: new Date(c.createdAt),
                })),
                totalChunks: data.totalChunks,
                extractedAt: new Date(data.extractedAt),
            };
            return fileContent;
        }
        catch (error) {
            console.warn(`Failed to load content for ${fileId}:`, error);
            return undefined;
        }
    }
    /**
     * 私有方法：取得檔案路徑
     */
    getFilePath(fileId) {
        return path.join(this.dataDir, `content-${fileId}.json`);
    }
    /**
     * 取得所有儲存的檔案 IDs
     */
    getAllFileIds() {
        return Array.from(this.indexStore.keys());
    }
    /**
     * 取得統計資訊（不載入完整內容）
     */
    getStats() {
        let totalChunks = 0;
        for (const index of this.indexStore.values()) {
            totalChunks += index.totalChunks;
        }
        return {
            totalFiles: this.indexStore.size,
            totalChunks,
            avgChunksPerFile: this.indexStore.size > 0 ? totalChunks / this.indexStore.size : 0,
        };
    }
}
exports.FileContentStore = FileContentStore;
exports.fileContentStore = new FileContentStore(true, './data');
