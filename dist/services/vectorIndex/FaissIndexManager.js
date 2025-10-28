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
exports.FaissIndexManager = void 0;
const faiss_node_1 = require("faiss-node");
const fs = __importStar(require("fs"));
class FaissIndexManager {
    constructor(dimensions) {
        this.index = null;
        this.vectorCount = 0;
        this.dimensions = dimensions;
    }
    /**
     * 從檔案載入索引
     */
    async load(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Index file not found: ${filePath}`);
        }
        console.log(`Loading FAISS index from ${filePath}...`);
        this.index = await faiss_node_1.IndexFlatIP.read(filePath);
        this.vectorCount = this.index.ntotal();
        console.log(`Index loaded successfully (${this.vectorCount} vectors, ${this.dimensions} dimensions)`);
    }
    /**
     * 搜尋最近鄰
     */
    async search(queryVector, k = 5) {
        if (!this.index) {
            throw new Error('Index not initialized');
        }
        if (queryVector.length !== this.dimensions) {
            throw new Error(`Query vector dimension mismatch: expected ${this.dimensions}, got ${queryVector.length}`);
        }
        if (this.vectorCount === 0) {
            return { labels: [], distances: [] };
        }
        // 確保 k 不超過向量總數
        const actualK = Math.min(k, this.vectorCount);
        // FAISS search 返回 { distances, labels }
        const result = this.index.search(queryVector, actualK);
        return {
            labels: result.labels,
            distances: result.distances,
        };
    }
    /**
     * 取得索引統計
     */
    getStats() {
        return {
            dimensions: this.dimensions,
            currentCount: this.vectorCount,
            isInitialized: this.index !== null,
        };
    }
    /**
     * 清理索引
     */
    clear() {
        if (this.index) {
            this.index = null;
        }
        this.vectorCount = 0;
    }
}
exports.FaissIndexManager = FaissIndexManager;
