"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressTracker = void 0;
const vectorIndex_1 = require("../../types/vectorIndex");
class ProgressTracker {
    constructor(jobId, fileId, totalItems = 0) {
        this.listeners = [];
        // 階段權重 (用於計算總進度)
        this.stageWeights = {
            [vectorIndex_1.VectorIndexStage.INITIALIZATION]: 5,
            [vectorIndex_1.VectorIndexStage.TEXT_EXTRACTION]: 15,
            [vectorIndex_1.VectorIndexStage.EMBEDDING_GENERATION]: 60,
            [vectorIndex_1.VectorIndexStage.INDEX_BUILDING]: 10,
            [vectorIndex_1.VectorIndexStage.METADATA_STORAGE]: 5,
            [vectorIndex_1.VectorIndexStage.S3_UPLOAD]: 5,
        };
        this.jobId = jobId;
        this.fileId = fileId;
        this.totalItems = totalItems;
        this.currentItems = 0;
        this.startTime = new Date();
        this.stageStartTime = new Date();
        this.currentStage = vectorIndex_1.VectorIndexStage.INITIALIZATION;
        this.currentStatus = vectorIndex_1.VectorIndexStatus.PENDING;
    }
    /**
     * 設定總項目數
     */
    setTotal(total) {
        this.totalItems = total;
    }
    /**
     * 更新當前項目數
     */
    update(current, message) {
        this.currentItems = current;
        this.emitProgress(message);
    }
    /**
     * 增量更新
     */
    increment(amount = 1, message) {
        this.currentItems += amount;
        this.emitProgress(message);
    }
    /**
     * 設定階段
     */
    setStage(stage, status = vectorIndex_1.VectorIndexStatus.PENDING) {
        this.currentStage = stage;
        this.currentStatus = status;
        this.stageStartTime = new Date();
        this.currentItems = 0; // 重置當前進度
        console.log(`Stage changed: ${stage} (${status})`);
        this.emitProgress(`Started ${stage}`);
    }
    /**
     * 設定狀態
     */
    setStatus(status, message) {
        this.currentStatus = status;
        this.emitProgress(message);
    }
    /**
     * 計算進度百分比
     */
    getProgress() {
        // 計算當前階段的權重進度
        const stageProgress = this.totalItems > 0
            ? (this.currentItems / this.totalItems) * 100
            : 0;
        // 計算已完成階段的權重總和
        const completedWeight = this.getCompletedStagesWeight();
        const currentStageWeight = this.stageWeights[this.currentStage] || 0;
        // 總進度 = 已完成階段權重 + (當前階段權重 × 當前階段進度)
        const totalProgress = completedWeight + (currentStageWeight * stageProgress / 100);
        const percentage = Math.min(Math.round(totalProgress), 100);
        // 估算剩餘時間 (ETA)
        const eta = this.estimateETA(percentage);
        return {
            current: this.currentItems,
            total: this.totalItems,
            percentage,
            currentBatch: this.currentItems,
            totalBatches: this.totalItems,
            eta,
        };
    }
    /**
     * 計算已完成階段的權重
     */
    getCompletedStagesWeight() {
        const stages = [
            vectorIndex_1.VectorIndexStage.INITIALIZATION,
            vectorIndex_1.VectorIndexStage.TEXT_EXTRACTION,
            vectorIndex_1.VectorIndexStage.EMBEDDING_GENERATION,
            vectorIndex_1.VectorIndexStage.INDEX_BUILDING,
            vectorIndex_1.VectorIndexStage.METADATA_STORAGE,
            vectorIndex_1.VectorIndexStage.S3_UPLOAD,
        ];
        let weight = 0;
        for (const stage of stages) {
            if (stage === this.currentStage) {
                break;
            }
            weight += this.stageWeights[stage] || 0;
        }
        return weight;
    }
    /**
     * 估算剩餘時間 (秒)
     */
    estimateETA(percentage) {
        if (percentage === 0) {
            return 0;
        }
        const elapsedMs = Date.now() - this.startTime.getTime();
        const totalEstimatedMs = (elapsedMs / percentage) * 100;
        const remainingMs = totalEstimatedMs - elapsedMs;
        return Math.max(0, Math.round(remainingMs / 1000));
    }
    /**
     * 註冊進度監聽器
     */
    onProgress(listener) {
        this.listeners.push(listener);
    }
    /**
     * 移除進度監聽器
     */
    offProgress(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }
    /**
     * 發送進度更新
     */
    emitProgress(message) {
        const update = {
            status: this.currentStatus,
            stage: this.currentStage,
            progress: this.getProgress(),
            message,
        };
        // 通知所有監聽器
        this.listeners.forEach(listener => {
            try {
                listener(update);
            }
            catch (error) {
                console.error('Progress listener error:', error);
            }
        });
    }
    /**
     * 標記完成
     */
    complete(message) {
        this.currentStatus = vectorIndex_1.VectorIndexStatus.COMPLETED;
        this.currentItems = this.totalItems;
        this.emitProgress(message || 'Completed successfully');
    }
    /**
     * 標記失敗
     */
    fail(error) {
        this.currentStatus = vectorIndex_1.VectorIndexStatus.FAILED;
        this.emitProgress(`Failed: ${error}`);
    }
    /**
     * 取得統計資訊
     */
    getStats() {
        const elapsedMs = Date.now() - this.startTime.getTime();
        const stageElapsedMs = Date.now() - this.stageStartTime.getTime();
        return {
            jobId: this.jobId,
            fileId: this.fileId,
            totalElapsedSeconds: Math.round(elapsedMs / 1000),
            stageElapsedSeconds: Math.round(stageElapsedMs / 1000),
            currentStage: this.currentStage,
            currentStatus: this.currentStatus,
            progress: this.getProgress(),
        };
    }
}
exports.ProgressTracker = ProgressTracker;
