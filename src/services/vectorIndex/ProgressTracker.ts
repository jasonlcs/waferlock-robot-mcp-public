import { VectorIndexProgress, VectorIndexStage, VectorIndexStatus } from '../../types/vectorIndex';

export interface ProgressUpdate {
  status: VectorIndexStatus;
  stage: VectorIndexStage;
  progress: VectorIndexProgress;
  message?: string;
}

export class ProgressTracker {
  private jobId: string;
  private fileId: string;
  private totalItems: number;
  private currentItems: number;
  private startTime: Date;
  private stageStartTime: Date;
  private currentStage: VectorIndexStage;
  private currentStatus: VectorIndexStatus;
  private listeners: ((update: ProgressUpdate) => void)[] = [];

  // 階段權重 (用於計算總進度)
  private stageWeights = {
    [VectorIndexStage.INITIALIZATION]: 5,
    [VectorIndexStage.TEXT_EXTRACTION]: 15,
    [VectorIndexStage.EMBEDDING_GENERATION]: 60,
    [VectorIndexStage.INDEX_BUILDING]: 10,
    [VectorIndexStage.METADATA_STORAGE]: 5,
    [VectorIndexStage.S3_UPLOAD]: 5,
  };

  constructor(jobId: string, fileId: string, totalItems: number = 0) {
    this.jobId = jobId;
    this.fileId = fileId;
    this.totalItems = totalItems;
    this.currentItems = 0;
    this.startTime = new Date();
    this.stageStartTime = new Date();
    this.currentStage = VectorIndexStage.INITIALIZATION;
    this.currentStatus = VectorIndexStatus.PENDING;
  }

  /**
   * 設定總項目數
   */
  setTotal(total: number): void {
    this.totalItems = total;
  }

  /**
   * 更新當前項目數
   */
  update(current: number, message?: string): void {
    this.currentItems = current;
    this.emitProgress(message);
  }

  /**
   * 增量更新
   */
  increment(amount: number = 1, message?: string): void {
    this.currentItems += amount;
    this.emitProgress(message);
  }

  /**
   * 設定階段
   */
  setStage(stage: VectorIndexStage, status: VectorIndexStatus = VectorIndexStatus.PENDING): void {
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
  setStatus(status: VectorIndexStatus, message?: string): void {
    this.currentStatus = status;
    this.emitProgress(message);
  }

  /**
   * 計算進度百分比
   */
  getProgress(): VectorIndexProgress {
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
  private getCompletedStagesWeight(): number {
    const stages = [
      VectorIndexStage.INITIALIZATION,
      VectorIndexStage.TEXT_EXTRACTION,
      VectorIndexStage.EMBEDDING_GENERATION,
      VectorIndexStage.INDEX_BUILDING,
      VectorIndexStage.METADATA_STORAGE,
      VectorIndexStage.S3_UPLOAD,
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
  private estimateETA(percentage: number): number {
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
  onProgress(listener: (update: ProgressUpdate) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除進度監聽器
   */
  offProgress(listener: (update: ProgressUpdate) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * 發送進度更新
   */
  private emitProgress(message?: string): void {
    const update: ProgressUpdate = {
      status: this.currentStatus,
      stage: this.currentStage,
      progress: this.getProgress(),
      message,
    };

    // 通知所有監聽器
    this.listeners.forEach(listener => {
      try {
        listener(update);
      } catch (error) {
        console.error('Progress listener error:', error);
      }
    });
  }

  /**
   * 標記完成
   */
  complete(message?: string): void {
    this.currentStatus = VectorIndexStatus.COMPLETED;
    this.currentItems = this.totalItems;
    this.emitProgress(message || 'Completed successfully');
  }

  /**
   * 標記失敗
   */
  fail(error: string): void {
    this.currentStatus = VectorIndexStatus.FAILED;
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
