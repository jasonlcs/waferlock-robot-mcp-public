import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

export class SocketManager {
  private io: SocketIOServer | null = null;
  private connectedClients: Map<string, Socket> = new Map();

  /**
   * 初始化 Socket.IO
   */
  initialize(httpServer: HTTPServer): void {
    if (this.io) {
      console.warn('Socket.IO already initialized');
      return;
    }

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket: Socket) => {
      console.log(`Client connected: ${socket.id}`);
      this.connectedClients.set(socket.id, socket);

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });

      // 加入檔案房間
      socket.on('join-file', (fileId: string) => {
        socket.join(`file:${fileId}`);
        console.log(`Client ${socket.id} joined room for file ${fileId}`);
      });

      // 離開檔案房間
      socket.on('leave-file', (fileId: string) => {
        socket.leave(`file:${fileId}`);
        console.log(`Client ${socket.id} left room for file ${fileId}`);
      });

      // 加入任務房間
      socket.on('join-job', (jobId: string) => {
        socket.join(`job:${jobId}`);
        console.log(`Client ${socket.id} joined room for job ${jobId}`);
      });
    });

    console.log('Socket.IO initialized');
  }

  /**
   * 發送進度更新到檔案房間
   */
  emitFileProgress(fileId: string, data: any): void {
    if (!this.io) return;
    this.io.to(`file:${fileId}`).emit('vector-index:progress', data);
  }

  /**
   * 發送進度更新到任務房間
   */
  emitJobProgress(jobId: string, data: any): void {
    if (!this.io) return;
    this.io.to(`job:${jobId}`).emit('vector-index:progress', data);
  }

  /**
   * 廣播進度更新
   */
  broadcastProgress(data: any): void {
    if (!this.io) return;
    this.io.emit('vector-index:progress', data);
  }

  /**
   * 發送完成事件
   */
  emitCompleted(jobId: string, data: any): void {
    if (!this.io) return;
    this.io.to(`job:${jobId}`).emit('vector-index:completed', data);
  }

  /**
   * 發送錯誤事件
   */
  emitError(jobId: string, data: any): void {
    if (!this.io) return;
    this.io.to(`job:${jobId}`).emit('vector-index:error', data);
  }

  /**
   * 取得 Socket.IO 實例
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * 取得連接的客戶端數量
   */
  getClientCount(): number {
    return this.connectedClients.size;
  }

  /**
   * 關閉 Socket.IO
   */
  close(): void {
    if (this.io) {
      this.io.close();
      this.io = null;
      this.connectedClients.clear();
      console.log('Socket.IO closed');
    }
  }
}

// 單例
export const socketManager = new SocketManager();
