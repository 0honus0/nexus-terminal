import type { Writable } from 'node:stream';

const FRAME_MAGIC = 0x4e585233; // NXR3
const FRAME_HEADER_BYTES = 16;
const FRAME_JSON = 1;
const MAX_JSON_BYTES = 256 * 1024;

export interface PluginIpcFrame {
  requestId: number;
  payload: Buffer;
}

const requestId = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
  return value;
};

export const encodePluginJsonFrame = (id: number, value: unknown): Buffer => {
  const normalizedId = requestId(id);
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.byteLength > MAX_JSON_BYTES) throw new Error('PLUGIN_RUNNER_FRAME_TOO_LARGE');
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.byteLength);
  frame.writeUInt32BE(FRAME_MAGIC, 0);
  frame.writeUInt8(FRAME_JSON, 4);
  frame.writeUInt8(0, 5);
  frame.writeUInt16BE(0, 6);
  frame.writeUInt32BE(normalizedId, 8);
  frame.writeUInt32BE(payload.byteLength, 12);
  payload.copy(frame, FRAME_HEADER_BYTES);
  return frame;
};

export const decodePluginJson = (frame: PluginIpcFrame): Record<string, unknown> => {
  try {
    const value = JSON.parse(frame.payload.toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, unknown>;
  } catch {
    throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
  }
};

export const writePluginFrame = (stream: Writable, frame: Uint8Array): Promise<void> => {
  if (!stream.writable || stream.destroyed) return Promise.reject(new Error('PLUGIN_RUNNER_NOT_RUNNING'));
  if (stream.write(frame)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
      stream.off('close', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('PLUGIN_RUNNER_NOT_RUNNING'));
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
    stream.once('close', onClose);
  });
};

export class PluginIpcDecoder {
  private readonly chunks: Buffer[] = [];
  private bufferedBytes = 0;

  push(chunk: Uint8Array): PluginIpcFrame[] {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (value.byteLength > 0) {
      this.chunks.push(value);
      this.bufferedBytes += value.byteLength;
    }
    const frames: PluginIpcFrame[] = [];
    while (this.bufferedBytes >= FRAME_HEADER_BYTES) {
      const header = this.peek(FRAME_HEADER_BYTES);
      if (
        header.readUInt32BE(0) !== FRAME_MAGIC ||
        header.readUInt8(4) !== FRAME_JSON ||
        header.readUInt8(5) !== 0 ||
        header.readUInt16BE(6) !== 0
      ) {
        throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
      }
      const id = header.readUInt32BE(8);
      const length = header.readUInt32BE(12);
      if (length > MAX_JSON_BYTES) throw new Error('PLUGIN_RUNNER_FRAME_TOO_LARGE');
      if (this.bufferedBytes < FRAME_HEADER_BYTES + length) break;
      this.consume(FRAME_HEADER_BYTES);
      frames.push({ requestId: id, payload: this.consume(length) });
    }
    return frames;
  }

  end(): void {
    if (this.bufferedBytes !== 0) throw new Error('PLUGIN_RUNNER_PROTOCOL_TRUNCATED');
  }

  private peek(bytes: number): Buffer {
    if (bytes < 0 || bytes > this.bufferedBytes) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
    const first = this.chunks[0];
    if (!first) return Buffer.alloc(0);
    if (first.byteLength >= bytes) return first.subarray(0, bytes);
    const result = Buffer.allocUnsafe(bytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      const copyBytes = Math.min(chunk.byteLength, bytes - offset);
      chunk.copy(result, offset, 0, copyBytes);
      offset += copyBytes;
      if (offset === bytes) return result;
    }
    throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
  }

  private consume(bytes: number): Buffer {
    if (bytes < 0 || bytes > this.bufferedBytes) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
    if (bytes === 0) return Buffer.alloc(0);
    const first = this.chunks[0];
    if (!first) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
    if (first.byteLength === bytes) {
      this.chunks.shift();
      this.bufferedBytes -= bytes;
      return first;
    }
    if (first.byteLength > bytes) {
      const result = first.subarray(0, bytes);
      this.chunks[0] = first.subarray(bytes);
      this.bufferedBytes -= bytes;
      return result;
    }
    const result = Buffer.allocUnsafe(bytes);
    let offset = 0;
    while (offset < bytes) {
      const chunk = this.chunks[0];
      if (!chunk) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
      const copyBytes = Math.min(chunk.byteLength, bytes - offset);
      chunk.copy(result, offset, 0, copyBytes);
      offset += copyBytes;
      if (copyBytes === chunk.byteLength) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(copyBytes);
    }
    this.bufferedBytes -= bytes;
    return result;
  }
}
