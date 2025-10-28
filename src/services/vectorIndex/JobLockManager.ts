/**
 * 任務鎖定管理器
 * 確保同一時間只有一個檔案在處理向量索引
 */

export interface JobLock {
  fileId: string;
  jobId: string;
  lockedAt: Date;
  lockedBy: string; // 處理程序 ID 或使用者
}

export class JobLockManager {
  private locks: Map<string, JobLock> = new Map();
  private globalLock: JobLock | null = null;
  private lockTimeout: number = 3600000; // 1 小時超時

  /**
   * 取得檔案鎖定
   */
  acquireFileLock(fileId: string, jobId: string): boolean {
    // 檢查是否已被鎖定
    if (this.locks.has(fileId)) {
      const lock = this.locks.get(fileId)!;
      
      // 檢查是否超時
      if (Date.now() - lock.lockedAt.getTime() > this.lockTimeout) {
        console.warn(`Lock for file ${fileId} has timed out, releasing...`);
        this.locks.delete(fileId);
      } else {
        console.log(`File ${fileId} is already locked by job ${lock.jobId}`);
        return false;
      }
    }

    // 建立鎖定
    this.locks.set(fileId, {
      fileId,
      jobId,
      lockedAt: new Date(),
      lockedBy: process.pid.toString(),
    });

    console.log(`Acquired lock for file ${fileId} (job ${jobId})`);
    return true;
  }

  /**
   * 釋放檔案鎖定
   */
  releaseFileLock(fileId: string): void {
    if (this.locks.delete(fileId)) {
      console.log(`Released lock for file ${fileId}`);
    }
  }

  /**
   * 檢查檔案是否被鎖定
   */
  isFileLocked(fileId: string): boolean {
    if (!this.locks.has(fileId)) {
      return false;
    }

    const lock = this.locks.get(fileId)!;
    
    // 檢查是否超時
    if (Date.now() - lock.lockedAt.getTime() > this.lockTimeout) {
      this.locks.delete(fileId);
      return false;
    }

    return true;
  }

  /**
   * 取得全域鎖定 (確保同時只處理一個任務)
   */
  acquireGlobalLock(jobId: string): boolean {
    if (this.globalLock) {
      // 檢查是否超時
      if (Date.now() - this.globalLock.lockedAt.getTime() > this.lockTimeout) {
        console.warn(`Global lock has timed out, releasing...`);
        this.globalLock = null;
      } else {
        console.log(`Global lock is held by job ${this.globalLock.jobId}`);
        return false;
      }
    }

    this.globalLock = {
      fileId: '',
      jobId,
      lockedAt: new Date(),
      lockedBy: process.pid.toString(),
    };

    console.log(`Acquired global lock (job ${jobId})`);
    return true;
  }

  /**
   * 釋放全域鎖定
   */
  releaseGlobalLock(): void {
    if (this.globalLock) {
      console.log(`Released global lock (job ${this.globalLock.jobId})`);
      this.globalLock = null;
    }
  }

  /**
   * 檢查是否有全域鎖定
   */
  isGloballyLocked(): boolean {
    if (!this.globalLock) {
      return false;
    }

    // 檢查是否超時
    if (Date.now() - this.globalLock.lockedAt.getTime() > this.lockTimeout) {
      this.globalLock = null;
      return false;
    }

    return true;
  }

  /**
   * 取得所有鎖定
   */
  getAllLocks(): JobLock[] {
    return Array.from(this.locks.values());
  }

  /**
   * 清理過期鎖定
   */
  cleanupExpiredLocks(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [fileId, lock] of this.locks.entries()) {
      if (now - lock.lockedAt.getTime() > this.lockTimeout) {
        this.locks.delete(fileId);
        cleaned++;
      }
    }

    if (this.globalLock && now - this.globalLock.lockedAt.getTime() > this.lockTimeout) {
      this.globalLock = null;
      cleaned++;
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired locks`);
    }
  }

  /**
   * 強制釋放所有鎖定 (僅用於緊急情況)
   */
  forceReleaseAll(): void {
    const count = this.locks.size + (this.globalLock ? 1 : 0);
    this.locks.clear();
    this.globalLock = null;
    console.warn(`Force released ${count} locks`);
  }
}

// 單例
export const jobLockManager = new JobLockManager();

// 定期清理過期鎖定
setInterval(() => {
  jobLockManager.cleanupExpiredLocks();
}, 60000); // 每分鐘清理一次
