import WebSocket, { type RawData } from 'ws';
import { workspaceSessionRegistry } from '../../../bootstrap/container/application.container';
import type { AuthenticatedWebSocket, WebSocketRequest } from '../types';
import { handleSftpUploadChunk } from '../handlers/upload.handler';

const UPLOAD_FRAME_MAGIC = Buffer.from('NXUP', 'ascii');
const UPLOAD_FRAME_VERSION = 1;
const UPLOAD_FRAME_FIXED_HEADER_SIZE = 12;
const MAX_UPLOAD_ID_BYTES = 512;
const MAX_UPLOAD_CHUNK_BYTES = 1024 * 1024;

const rawDataToBuffer = (message: RawData): Buffer => {
  if (Buffer.isBuffer(message)) return message;
  if (Array.isArray(message)) return Buffer.concat(message);
  return Buffer.from(message);
};

export interface BinaryUploadChunk {
  uploadId: string;
  chunkIndex: number;
  isLast: boolean;
  data: Buffer;
}

export const parseBinaryUploadChunk = (message: RawData): BinaryUploadChunk => {
  const frame = rawDataToBuffer(message);
  if (frame.length < UPLOAD_FRAME_FIXED_HEADER_SIZE) throw new Error('二进制上传帧过短');
  if (!frame.subarray(0, 4).equals(UPLOAD_FRAME_MAGIC)) throw new Error('未知的二进制消息类型');
  if (frame.readUInt8(4) !== UPLOAD_FRAME_VERSION) {
    throw new Error(`不支持的上传协议版本: ${frame.readUInt8(4)}`);
  }

  const flags = frame.readUInt8(5);
  if ((flags & ~1) !== 0) throw new Error('上传帧包含未知标志');
  const uploadIdLength = frame.readUInt16BE(6);
  const chunkIndex = frame.readUInt32BE(8);
  if (uploadIdLength === 0 || uploadIdLength > MAX_UPLOAD_ID_BYTES) throw new Error('上传任务 ID 长度无效');

  const payloadOffset = UPLOAD_FRAME_FIXED_HEADER_SIZE + uploadIdLength;
  if (payloadOffset > frame.length) throw new Error('上传帧头长度越界');
  const uploadId = frame.toString('utf8', UPLOAD_FRAME_FIXED_HEADER_SIZE, payloadOffset);
  if (!uploadId) throw new Error('上传任务 ID 为空');

  const data = frame.subarray(payloadOffset);
  if (data.length > MAX_UPLOAD_CHUNK_BYTES) {
    throw new Error(`上传分块超过限制: ${data.length}/${MAX_UPLOAD_CHUNK_BYTES} 字节`);
  }
  return { uploadId, chunkIndex, isLast: (flags & 1) === 1, data };
};

export function bindUploadBinaryTransport(ws: AuthenticatedWebSocket, request: WebSocketRequest): boolean {
  if (!request.isUploadTransport) return false;

  const uploadSessionId = request.uploadSessionId;
  const state = uploadSessionId ? workspaceSessionRegistry.get(uploadSessionId) : undefined;
  if (!uploadSessionId || !state || state.ws.userId !== ws.userId) {
    console.warn(`WebSocket: 拒绝上传数据通道绑定，用户 ${ws.username} 无权访问会话 ${uploadSessionId || '(missing)'}。`);
    ws.close(1008, 'Invalid upload session');
    return true;
  }

  ws.sessionId = uploadSessionId;
  if (state.uploadWs && state.uploadWs !== ws && state.uploadWs.readyState === WebSocket.OPEN) {
    state.uploadWs.close(1000, 'Upload transport replaced');
  }
  state.uploadWs = ws;
  console.log(`WebSocket: 会话 ${uploadSessionId} 的独立上传数据通道已连接。`);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'sftp:upload:transport:ready', payload: { sessionId: uploadSessionId } }));
  }

  ws.on('message', async (message: RawData, isBinary: boolean) => {
    ws.isAlive = true;
    if (!isBinary) {
      console.warn(`WebSocket: 上传数据通道 ${uploadSessionId} 收到非二进制消息，已拒绝。`);
      ws.close(1003, 'Upload transport accepts binary frames only');
      return;
    }
    try {
      await handleSftpUploadChunk(ws, parseBinaryUploadChunk(message));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`WebSocket: 上传数据通道 ${uploadSessionId} 的二进制消息无效: ${errorMessage}`);
      if (state.ws.readyState === state.ws.OPEN) {
        state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { message: errorMessage } }));
      }
      ws.close(1003, 'Invalid upload frame');
    }
  });

  const detach = () => {
    const currentState = workspaceSessionRegistry.get(uploadSessionId);
    if (currentState?.uploadWs === ws) currentState.uploadWs = undefined;
  };
  ws.on('close', (code, reason) => {
    detach();
    console.log(`WebSocket: 会话 ${uploadSessionId} 的上传数据通道已断开。代码: ${code}, 原因: ${reason.toString()}`);
  });
  ws.on('error', (error) => {
    detach();
    console.error(`WebSocket: 会话 ${uploadSessionId} 的上传数据通道发生错误:`, error);
  });
  return true;
}
