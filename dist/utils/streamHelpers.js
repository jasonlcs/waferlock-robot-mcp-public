"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamToString = exports.streamToBuffer = void 0;
const toBuffer = (chunk) => typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
async function streamToBuffer(stream) {
    if (!stream) {
        return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(stream)) {
        return stream;
    }
    if (typeof stream === 'string') {
        return Buffer.from(stream, 'utf-8');
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => {
            chunks.push(toBuffer(chunk));
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (error) => reject(error));
    });
}
exports.streamToBuffer = streamToBuffer;
async function streamToString(stream) {
    const buffer = await streamToBuffer(stream);
    return buffer.toString('utf-8');
}
exports.streamToString = streamToString;
