/**
 * Thinking Store - 管理 AI 的思考過程
 * 參考 Serena 的 thinking tools 設計
 */

export interface ThinkingSession {
  id: string;
  topic: string;
  context?: string;
  thoughts: ThoughtEntry[];
  startedAt: Date;
  completedAt?: Date;
  conclusion?: string;
}

export interface ThoughtEntry {
  thought: string;
  type: 'observation' | 'analysis' | 'comparison' | 'question' | 'conclusion';
  timestamp: Date;
  metadata?: Record<string, any>;
}

class ThinkingStore {
  private sessions: Map<string, ThinkingSession> = new Map();
  private maxSessions = 100; // 限制最大會話數

  /**
   * 創建新的思考會話
   */
  createSession(topic: string, context?: string): ThinkingSession {
    const id = this.generateId();
    const session: ThinkingSession = {
      id,
      topic,
      context,
      thoughts: [],
      startedAt: new Date(),
    };

    this.sessions.set(id, session);
    this.cleanupOldSessions();

    return session;
  }

  /**
   * 添加思考內容
   */
  addThought(
    sessionId: string,
    thought: string,
    type: ThoughtEntry['type'] = 'observation',
    metadata?: Record<string, any>
  ): ThoughtEntry {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Thinking session ${sessionId} not found`);
    }

    const entry: ThoughtEntry = {
      thought,
      type,
      timestamp: new Date(),
      metadata,
    };

    session.thoughts.push(entry);
    return entry;
  }

  /**
   * 完成思考會話
   */
  completeSession(sessionId: string, conclusion: string): ThinkingSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Thinking session ${sessionId} not found`);
    }

    session.completedAt = new Date();
    session.conclusion = conclusion;

    return session;
  }

  /**
   * 獲取會話
   */
  getSession(sessionId: string): ThinkingSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 列出所有活躍會話
   */
  listActiveSessions(): ThinkingSession[] {
    return Array.from(this.sessions.values())
      .filter(s => !s.completedAt)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  /**
   * 刪除會話
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `think-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清理舊會話（保留最近的 maxSessions 個）
   */
  private cleanupOldSessions(): void {
    const sessions = Array.from(this.sessions.entries())
      .sort((a, b) => b[1].startedAt.getTime() - a[1].startedAt.getTime());

    if (sessions.length > this.maxSessions) {
      const toDelete = sessions.slice(this.maxSessions);
      toDelete.forEach(([id]) => this.sessions.delete(id));
    }
  }

  /**
   * 獲取會話統計
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    totalThoughts: number;
  } {
    const all = Array.from(this.sessions.values());
    const active = all.filter(s => !s.completedAt);
    const completed = all.filter(s => s.completedAt);
    const totalThoughts = all.reduce((sum, s) => sum + s.thoughts.length, 0);

    return {
      totalSessions: all.length,
      activeSessions: active.length,
      completedSessions: completed.length,
      totalThoughts,
    };
  }
}

export const thinkingStore = new ThinkingStore();
