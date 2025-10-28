import { Readable } from 'stream';

type StreamLike = Readable | NodeJS.ReadableStream | Buffer | Uint8Array | string | null;

const toBuffer = (chunk: Buffer | Uint8Array | string) =>
  typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);

export async function streamToBuffer(stream: StreamLike): Promise<Buffer> {
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
    const chunks: Buffer[] = [];
    (stream as NodeJS.ReadableStream).on('data', (chunk: Buffer | Uint8Array | string) => {
      chunks.push(toBuffer(chunk));
    });
    (stream as NodeJS.ReadableStream).on('end', () => resolve(Buffer.concat(chunks)));
    (stream as NodeJS.ReadableStream).on('error', (error) => reject(error));
  });
}

export async function streamToString(stream: StreamLike): Promise<string> {
  const buffer = await streamToBuffer(stream);
  return buffer.toString('utf-8');
}
