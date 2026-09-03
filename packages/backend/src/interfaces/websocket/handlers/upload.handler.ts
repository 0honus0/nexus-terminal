import type { AuthenticatedWebSocket } from '../types';
import { workspaceSessionRegistry, workspaceSftpUploadService } from '../../../bootstrap/container/application.container';
import WebSocket from 'ws';

export async function handleSftpUploadStart(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;

  if (!sessionId || !state) {
    console.warn(`WebSocket: 收到来自 ${ws.username} 的 SFTP 上传开始请求，但无活动会话。`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '无效的会话' } }),
      );
    return;
  }
  if (!payload?.uploadId || !payload?.remotePath || typeof payload?.size !== 'number') {
    console.error(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:start 请求，但缺少 uploadId, remotePath 或 size。`,
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId: payload?.uploadId, message: '缺少 uploadId, remotePath 或 size' },
        }),
      );
    return;
  }
  const relativePath = payload?.relativePath;
  const prepareId = payload?.prepareId;
  const conflictPolicy = payload?.conflictPolicy;
  if (conflictPolicy !== undefined && !['ask', 'overwrite', 'skip'].includes(conflictPolicy)) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId: payload.uploadId, message: '无效的同名文件处理策略' },
        }),
      );
    }
    return;
  }
  console.log(
    `WebSocket: SFTP Upload Start - Session: ${sessionId}, UploadID: ${payload.uploadId}, RemotePath: ${payload.remotePath}, Size: ${payload.size}, RelativePath: ${relativePath}, PrepareID: ${prepareId}`,
  );
  await workspaceSftpUploadService.startUpload(
    sessionId,
    payload.uploadId,
    payload.remotePath,
    payload.size,
    relativePath,
    prepareId,
    conflictPolicy ?? 'ask',
  );
}

export async function handleSftpUploadPrepare(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;
  const prepareId = payload?.prepareId;

  if (!sessionId || !state) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sftp:upload:prepare:error', payload: { prepareId, message: '无效的会话' } }));
    }
    return;
  }
  if (!prepareId || typeof payload?.basePath !== 'string' || !Array.isArray(payload?.directories)) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({ type: 'sftp:upload:prepare:error', payload: { prepareId, message: '上传路径准备参数无效' } }),
      );
    }
    return;
  }

  try {
    const result = await workspaceSftpUploadService.prepareUploadDirectories(
      sessionId,
      prepareId,
      payload.basePath,
      payload.directories,
    );
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'sftp:upload:prepare:ready',
          payload: { prepareId, ...result },
        }),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`WebSocket: SFTP upload prepare failed for ${prepareId}:`, error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sftp:upload:prepare:error', payload: { prepareId, message } }));
    }
  }
}

export interface BinaryUploadChunkPayload {
  uploadId: string;
  chunkIndex: number;
  isLast: boolean;
  data: Buffer;
}

export async function handleSftpUploadChunk(
  ws: AuthenticatedWebSocket,
  payload: BinaryUploadChunkPayload,
): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;
  if (!sessionId || !state) return;

  if (
    !payload.uploadId ||
    !Number.isInteger(payload.chunkIndex) ||
    payload.chunkIndex < 0 ||
    typeof payload.isLast !== 'boolean' ||
    !Buffer.isBuffer(payload.data)
  ) {
    console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效二进制上传分块。`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId: payload.uploadId, message: '二进制上传分块格式无效' },
        }),
      );
    }
    return;
  }
  await workspaceSftpUploadService.handleUploadChunk(sessionId, payload.uploadId, payload.chunkIndex, payload.data, payload.isLast);
}

export async function handleSftpUploadCancelAll(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;
  if (!sessionId || !state) return;

  const uploadIds = payload?.uploadIds;
  if (!Array.isArray(uploadIds) || uploadIds.some((id: unknown) => typeof id !== 'string')) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { message: 'uploadIds 参数无效' } }));
    }
    return;
  }
  await workspaceSftpUploadService.cancelUploads(sessionId, uploadIds);
}

export async function handleSftpUploadCancel(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;
  if (!sessionId || !state) return; // Silently ignore

  if (!payload?.uploadId) {
    console.error(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:cancel 请求，但缺少 uploadId。`,
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId: payload?.uploadId, message: '缺少 uploadId' },
        }),
      );
    return;
  }
  await workspaceSftpUploadService.cancelUpload(sessionId, payload.uploadId);
}
