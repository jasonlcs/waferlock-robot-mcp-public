"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketManager = exports.SocketManager = void 0;
const socket_io_1 = require("socket.io");
class SocketManager {
    constructor() {
        this.io = null;
        this.connectedClients = new Map();
    }
    /**
     * 初始化 Socket.IO
     */
    initialize(httpServer) {
        if (this.io) {
            console.warn('Socket.IO already initialized');
            return;
        }
        this.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        });
        this.io.on('connection', (socket) => {
            console.log(`Client connected: ${socket.id}`);
            this.connectedClients.set(socket.id, socket);
            socket.on('disconnect', () => {
                console.log(`Client disconnected: ${socket.id}`);
                this.connectedClients.delete(socket.id);
            });
            // 加入檔案房間
            socket.on('join-file', (fileId) => {
                socket.join(`file:${fileId}`);
                console.log(`Client ${socket.id} joined room for file ${fileId}`);
            });
            // 離開檔案房間
            socket.on('leave-file', (fileId) => {
                socket.leave(`file:${fileId}`);
                console.log(`Client ${socket.id} left room for file ${fileId}`);
            });
            // 加入任務房間
            socket.on('join-job', (jobId) => {
                socket.join(`job:${jobId}`);
                console.log(`Client ${socket.id} joined room for job ${jobId}`);
            });
        });
        console.log('Socket.IO initialized');
    }
    /**
     * 發送進度更新到檔案房間
     */
    emitFileProgress(fileId, data) {
        if (!this.io)
            return;
        this.io.to(`file:${fileId}`).emit('vector-index:progress', data);
    }
    /**
     * 發送進度更新到任務房間
     */
    emitJobProgress(jobId, data) {
        if (!this.io)
            return;
        this.io.to(`job:${jobId}`).emit('vector-index:progress', data);
    }
    /**
     * 廣播進度更新
     */
    broadcastProgress(data) {
        if (!this.io)
            return;
        this.io.emit('vector-index:progress', data);
    }
    /**
     * 發送完成事件
     */
    emitCompleted(jobId, data) {
        if (!this.io)
            return;
        this.io.to(`job:${jobId}`).emit('vector-index:completed', data);
    }
    /**
     * 發送錯誤事件
     */
    emitError(jobId, data) {
        if (!this.io)
            return;
        this.io.to(`job:${jobId}`).emit('vector-index:error', data);
    }
    /**
     * 取得 Socket.IO 實例
     */
    getIO() {
        return this.io;
    }
    /**
     * 取得連接的客戶端數量
     */
    getClientCount() {
        return this.connectedClients.size;
    }
    /**
     * 關閉 Socket.IO
     */
    close() {
        if (this.io) {
            this.io.close();
            this.io = null;
            this.connectedClients.clear();
            console.log('Socket.IO closed');
        }
    }
}
exports.SocketManager = SocketManager;
// 單例
exports.socketManager = new SocketManager();
