import { AuthenticatedWebSocket } from '../types';
import {
  workspaceArchiveService,
  workspaceFilesystemService,
  workspaceSessionRegistry,
  workspaceSftpTransferService,
  workspaceSftpUploadService,
} from '../../runtime/service-container';
import WebSocket from 'ws';

const DIRECT_FILESYSTEM_TYPES = new Set([
  'sftp:readdir',
  'sftp:search',
  'sftp:stat',
  'sftp:readfile',
  'sftp:writefile',
  'sftp:mkdir',
  'sftp:rmdir',
  'sftp:unlink',
  'sftp:rename',
  'sftp:chmod',
  'sftp:realpath',
  'sftp:delete_paths',
]);

function sendDirectFilesystemError(
  ws: AuthenticatedWebSocket,
  type: string,
  payload: any,
  requestId: string,
  error: unknown,
): boolean {
  if (!DIRECT_FILESYSTEM_TYPES.has(type) || ws.readyState !== WebSocket.OPEN) return false;
  const message = error instanceof Error ? error.message : String(error);
  const response: Record<string, unknown> = {
    type: `${type}:error`,
    requestId,
    payload: message,
  };
  if (payload?.path) response.path = payload.path;
  if (payload?.oldPath) response.oldPath = payload.oldPath;
  if (payload?.newPath) response.newPath = payload.newPath;
  if (type === 'sftp:realpath') {
    response.payload = { requestedPath: payload?.path, error: message };
  }
  ws.send(JSON.stringify(response));
  return true;
}

export async function handleSftpOperation(
  ws: AuthenticatedWebSocket,
  type: string,
  payload: any,
  requestId?: string,
): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;

  if (!sessionId || !state) {
    console.warn(`WebSocket: 收到来自 ${ws.username} 的 SFTP 请求 (${type})，但无活动会话。`);
    const errPayload: { message: string; requestId?: string } = { message: '无效的会话' };
    if (requestId) errPayload.requestId = requestId;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: errPayload }));
    return;
  }
  if (!requestId) {
    console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SFTP 请求 (${type})，但缺少 requestId。`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `SFTP 操作 ${type} 缺少 requestId` } }));
    return;
  }

  try {
    const filesystemTarget = workspaceFilesystemService.forSession(sessionId);
    if (!filesystemTarget) throw new Error('SSH 会话未就绪');
    const { filesystem, removal } = filesystemTarget;

    switch (type) {
      case 'sftp:readdir': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for readdir");
        const result = await filesystem.list(payload.path);
        ws.send(JSON.stringify({ type: 'sftp:readdir:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:search': {
        if (!payload?.path || typeof payload?.query !== 'string') {
          throw new Error("Missing 'path' or 'query' in payload for search");
        }
        const result = await filesystem.search(payload.path, payload.query);
        ws.send(JSON.stringify({ type: 'sftp:search:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:stat': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for stat");
        const result = await filesystem.stat(payload.path);
        ws.send(JSON.stringify({ type: 'sftp:stat:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:readfile': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for readfile");
        const result = await filesystem.readFile(payload.path, payload?.encoding);
        ws.send(JSON.stringify({ type: 'sftp:readfile:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:writefile': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for writefile");
        const fileContent = payload?.content ?? payload?.data ?? '';
        const dataToSend = typeof fileContent === 'string' ? fileContent : '';
        const result = await filesystem.writeFile(payload.path, dataToSend, payload?.encoding || 'utf-8');
        ws.send(JSON.stringify({ type: 'sftp:writefile:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:mkdir': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for mkdir");
        const result = await filesystem.mkdir(payload.path);
        ws.send(JSON.stringify({ type: 'sftp:mkdir:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:rmdir': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for rmdir");
        await removal.removeDirectoryForce(payload.path);
        ws.send(JSON.stringify({ type: 'sftp:rmdir:success', path: payload.path, requestId }));
        break;
      }
      case 'sftp:unlink': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for unlink");
        await filesystem.unlink(payload.path);
        ws.send(JSON.stringify({ type: 'sftp:unlink:success', path: payload.path, requestId }));
        break;
      }
      case 'sftp:rename': {
        if (!payload?.oldPath || !payload?.newPath) throw new Error("Missing 'oldPath' or 'newPath' in payload for rename");
        const newItem = await filesystem.rename(payload.oldPath, payload.newPath);
        ws.send(JSON.stringify({
          type: 'sftp:rename:success',
          payload: { oldPath: payload.oldPath, newPath: payload.newPath, newItem },
          requestId,
        }));
        break;
      }
      case 'sftp:chmod': {
        if (!payload?.path || typeof payload?.mode !== 'number') throw new Error("Missing 'path' or invalid 'mode' in payload for chmod");
        const result = await filesystem.chmod(payload.path, payload.mode);
        ws.send(JSON.stringify({ type: 'sftp:chmod:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:realpath': {
        if (!payload?.path) throw new Error("Missing 'path' in payload for realpath");
        const result = await filesystem.realpath(payload.path);
        ws.send(JSON.stringify({ type: 'sftp:realpath:success', path: payload.path, payload: result, requestId }));
        break;
      }
      case 'sftp:copy':
        if (Array.isArray(payload?.sources) && payload?.destination) {
          workspaceSftpTransferService.copy(sessionId, payload.sources, payload.destination, requestId);
        } else throw new Error("Missing 'sources' (array) or 'destination' in payload for copy");
        break;
      case 'sftp:cross_copy':
        if (typeof payload?.sourceSessionId === 'string' && Array.isArray(payload?.sources) && payload?.destination) {
          workspaceSftpTransferService.copyAcrossSessions(
            sessionId,
            payload.sourceSessionId,
            payload.sources,
            payload.destination,
            requestId,
          );
        } else
          throw new Error("Missing 'sourceSessionId', 'sources' (array), or 'destination' in payload for cross copy");
        break;
      case 'sftp:delete_paths': {
        if (!Array.isArray(payload?.paths)) throw new Error("Missing 'paths' (array) in payload for delete paths");
        await removal.removePaths(payload.paths);
        ws.send(JSON.stringify({
          type: 'sftp:delete_paths:success',
          payload: { paths: payload.paths },
          requestId,
        }));
        break;
      }
      case 'sftp:move':
        if (Array.isArray(payload?.sources) && payload?.destination) {
          workspaceSftpTransferService.move(sessionId, payload.sources, payload.destination, requestId);
        } else throw new Error("Missing 'sources' (array) or 'destination' in payload for move");
        break;
      case 'sftp:transfer:cancel': {
        const transferRequestId = payload?.requestId || requestId;
        if (transferRequestId) await workspaceSftpTransferService.cancelTransfer(sessionId, transferRequestId);
        else throw new Error("Missing 'requestId' in payload for transfer cancellation");
        break;
      }
      case 'sftp:compress':
        if (Array.isArray(payload?.sources) && payload?.destination && payload?.format && requestId) {
          const destinationPath = payload.destination as string;
          // 从 destinationPath 中提取 targetDirectory 和 destinationArchiveName
          // pathModule.posix 总是使用 / 作为分隔符
          const pathModule = await import('path'); // 动态导入 path 模块
          const targetDirectory = pathModule.posix.dirname(destinationPath);
          const destinationArchiveName = pathModule.posix.basename(destinationPath);

          const compressPayload = {
            sources: payload.sources as string[],
            destinationArchiveName: destinationArchiveName,
            format: payload.format as 'zip' | 'targz' | 'tarbz2',
            targetDirectory: targetDirectory,
            ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
            requestId: requestId,
          };
          workspaceArchiveService.compress(sessionId, compressPayload);
        } else
          throw new Error("Missing 'sources' (array), 'destination', 'format', or 'requestId' in payload for compress");
        break;
      case 'sftp:archive:cancel': {
        const archiveRequestId = payload?.requestId || requestId;
        if (archiveRequestId) await workspaceArchiveService.cancelArchive(sessionId, archiveRequestId);
        else throw new Error("Missing 'requestId' in payload for archive cancellation");
        break;
      }
      case 'sftp:decompress':
        if (payload?.source && requestId) {
          const decompressPayload = {
            archivePath: payload.source as string,
            // destinationDirectory intentionally omitted: extraction occurs beside the archive
            ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
            requestId: requestId,
          };
          workspaceArchiveService.decompress(sessionId, decompressPayload);
        } else throw new Error("Missing 'source' or 'requestId' in payload for decompress");
        break;
      default:
        console.warn(`WebSocket: Received unhandled SFTP message type in sftp.handler: ${type}`);
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({ type: 'sftp_error', payload: { message: `内部未处理的 SFTP 类型: ${type}`, requestId } }),
          );
        throw new Error(`Unhandled SFTP type: ${type}`);
    }
  } catch (sftpCallError: any) {
    console.error(
      `WebSocket: Error preparing/calling SFTP service for ${type} (Request ID: ${requestId}):`,
      sftpCallError,
    );
    if (sendDirectFilesystemError(ws, type, payload, requestId, sftpCallError)) return;
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'sftp_error',
          payload: { message: `处理 SFTP 请求 ${type} 时出错: ${sftpCallError.message}`, requestId },
        }),
      );
  }
}

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
