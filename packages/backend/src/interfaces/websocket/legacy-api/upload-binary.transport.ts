import type { RawData } from 'ws';

const MAGIC = Buffer.from('NXUP', 'ascii');
const VERSION = 1;
const FIXED_HEADER_SIZE = 12;
const MAX_UPLOAD_ID_BYTES = 512;
const MAX_UPLOAD_CHUNK_BYTES = 1024 * 1024;

export interface LegacyBinaryUploadChunk {
  uploadId: string;
  chunkIndex: number;
  isLast: boolean;
  data: Uint8Array;
}

const rawDataToBuffer = (message: RawData): Buffer => {
  if (Buffer.isBuffer(message)) return message;
  if (Array.isArray(message)) return Buffer.concat(message);
  return Buffer.from(message);
};

/** Current frontend NXUP upload frame parser. Delete with the legacy WebSocket adapter. */
export const parseLegacyUploadBinaryFrame = (message: RawData): LegacyBinaryUploadChunk => {
  const frame = rawDataToBuffer(message);
  if (frame.length < FIXED_HEADER_SIZE) throw new Error('二进制上传帧过短');
  if (!frame.subarray(0, 4).equals(MAGIC)) throw new Error('未知的二进制消息类型');
  const version = frame.readUInt8(4);
  if (version !== VERSION) throw new Error(`不支持的上传协议版本: ${version}`);

  const flags = frame.readUInt8(5);
  if ((flags & ~1) !== 0) throw new Error('上传帧包含未知标志');
  const uploadIdLength = frame.readUInt16BE(6);
  const chunkIndex = frame.readUInt32BE(8);
  if (uploadIdLength === 0 || uploadIdLength > MAX_UPLOAD_ID_BYTES) throw new Error('上传任务 ID 长度无效');
  const payloadOffset = FIXED_HEADER_SIZE + uploadIdLength;
  if (payloadOffset > frame.length) throw new Error('上传帧头长度越界');
  const uploadId = frame.toString('utf8', FIXED_HEADER_SIZE, payloadOffset);
  if (!uploadId) throw new Error('上传任务 ID 为空');
  const data = frame.subarray(payloadOffset);
  if (data.length > MAX_UPLOAD_CHUNK_BYTES) {
    throw new Error(`上传分块超过限制: ${data.length}/${MAX_UPLOAD_CHUNK_BYTES} 字节`);
  }
  return { uploadId, chunkIndex, isLast: (flags & 1) === 1, data };
};
