import { AuthenticatedWebSocket } from '../types';
import { clientStates, sftpService } from '../state';
import WebSocket from 'ws';

export async function handleSftpOperation(
    ws: AuthenticatedWebSocket,
    type: string,
    payload: any,
    requestId?: string
): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!sessionId || !state) {
        console.warn(`WebSocket: 收到来自 ${ws.username} 的 SFTP 请求 (${type})，但无活动会话。`);
        const errPayload: { message: string; requestId?: string } = { message: '无效的会话' };
        if (requestId) errPayload.requestId = requestId;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: errPayload }));
        return;
    }
    if (!requestId) {
        console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SFTP 请求 (${type})，但缺少 requestId。`);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `SFTP 操作 ${type} 缺少 requestId` } }));
        return;
    }

    try {
        switch (type) {
            case 'sftp:readdir':
                if (payload?.path) sftpService.readdir(sessionId, payload.path, requestId);
                else throw new Error("Missing 'path' in payload for readdir");
                break;
            case 'sftp:stat':
                if (payload?.path) sftpService.stat(sessionId, payload.path, requestId);
                else throw new Error("Missing 'path' in payload for stat");
                break;
            case 'sftp:readfile':
                if (payload?.path) {
                    const requestedEncoding = payload?.encoding;
                    sftpService.readFile(sessionId, payload.path, requestId, requestedEncoding);
                } else {
                    throw new Error("Missing 'path' in payload for readfile");
                }
                break;
            case 'sftp:writefile':
                const fileContent = payload?.content ?? payload?.data ?? '';
                const encoding = payload?.encoding;
                if (payload?.path) {
                    const dataToSend = (typeof fileContent === 'string') ? fileContent : '';
                    // 保留用户选择的换行符，并等待写入失败结果传回前端。
                    await sftpService.writefile(sessionId, payload.path, dataToSend, requestId, encoding);
                } else throw new Error("Missing 'path' in payload for writefile");
                break;
            case 'sftp:mkdir':
                 if (payload?.path) sftpService.mkdir(sessionId, payload.path, requestId);
                 else throw new Error("Missing 'path' in payload for mkdir");
                 break;
            case 'sftp:rmdir':
                 if (payload?.path) sftpService.rmdir(sessionId, payload.path, requestId);
                 else throw new Error("Missing 'path' in payload for rmdir");
                 break;
            case 'sftp:unlink':
                 if (payload?.path) sftpService.unlink(sessionId, payload.path, requestId);
                 else throw new Error("Missing 'path' in payload for unlink");
                 break;
            case 'sftp:rename':
                 if (payload?.oldPath && payload?.newPath) sftpService.rename(sessionId, payload.oldPath, payload.newPath, requestId);
                 else throw new Error("Missing 'oldPath' or 'newPath' in payload for rename");
                 break;
            case 'sftp:chmod':
                 if (payload?.path && typeof payload?.mode === 'number') sftpService.chmod(sessionId, payload.path, payload.mode, requestId);
                 else throw new Error("Missing 'path' or invalid 'mode' in payload for chmod");
                 break;
            case 'sftp:realpath':
                if (payload?.path) sftpService.realpath(sessionId, payload.path, requestId);
                else throw new Error("Missing 'path' in payload for realpath");
                break;
            case 'sftp:copy':
                if (Array.isArray(payload?.sources) && payload?.destination) {
                    sftpService.copy(sessionId, payload.sources, payload.destination, requestId);
                } else throw new Error("Missing 'sources' (array) or 'destination' in payload for copy");
                break;
            case 'sftp:cross_copy':
                if (typeof payload?.sourceSessionId === 'string' && Array.isArray(payload?.sources) && payload?.destination) {
                    sftpService.copyAcrossSessions(sessionId, payload.sourceSessionId, payload.sources, payload.destination, requestId);
                } else throw new Error("Missing 'sourceSessionId', 'sources' (array), or 'destination' in payload for cross copy");
                break;
            case 'sftp:delete_paths':
                if (Array.isArray(payload?.paths)) {
                    await sftpService.deletePaths(sessionId, payload.paths, requestId);
                } else throw new Error("Missing 'paths' (array) in payload for delete paths");
                break;
            case 'sftp:move':
                 if (Array.isArray(payload?.sources) && payload?.destination) {
                    sftpService.move(sessionId, payload.sources, payload.destination, requestId);
                } else throw new Error("Missing 'sources' (array) or 'destination' in payload for move");
                break;
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
                        requestId: requestId
                    };
                    sftpService.compress(sessionId, compressPayload);
                } else throw new Error("Missing 'sources' (array), 'destination', 'format', or 'requestId' in payload for compress");
                break;
            case 'sftp:archive:cancel': {
                const archiveRequestId = payload?.requestId || requestId;
                if (archiveRequestId) await sftpService.cancelArchive(sessionId, archiveRequestId);
                else throw new Error("Missing 'requestId' in payload for archive cancellation");
                break;
            }
            case 'sftp:decompress':
                if (payload?.source && requestId) {
                    const decompressPayload = {
                        archivePath: payload.source as string,
                        // destinationDirectory: payload.destination as string, // sftpService.decompress 目前不使用此参数
                        ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
                        requestId: requestId
                    };
                    sftpService.decompress(sessionId, decompressPayload);
                } else throw new Error("Missing 'source' or 'requestId' in payload for decompress");
                break;
            default:
                console.warn(`WebSocket: Received unhandled SFTP message type in sftp.handler: ${type}`);
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `内部未处理的 SFTP 类型: ${type}`, requestId } }));
                throw new Error(`Unhandled SFTP type: ${type}`);
        }
    } catch (sftpCallError: any) {
         console.error(`WebSocket: Error preparing/calling SFTP service for ${type} (Request ID: ${requestId}):`, sftpCallError);
         if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `处理 SFTP 请求 ${type} 时出错: ${sftpCallError.message}`, requestId } }));
    }
}

export async function handleSftpUploadStart(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!sessionId || !state) {
        console.warn(`WebSocket: 收到来自 ${ws.username} 的 SFTP 上传开始请求，但无活动会话。`);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '无效的会话' } }));
        return;
    }
    if (!payload?.uploadId || !payload?.remotePath || typeof payload?.size !== 'number') {
        console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:start 请求，但缺少 uploadId, remotePath 或 size。`);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '缺少 uploadId, remotePath 或 size' } }));
        return;
    }
    const relativePath = payload?.relativePath;
    const prepareId = payload?.prepareId;
    console.log(`WebSocket: SFTP Upload Start - Session: ${sessionId}, UploadID: ${payload.uploadId}, RemotePath: ${payload.remotePath}, Size: ${payload.size}, RelativePath: ${relativePath}, PrepareID: ${prepareId}`);
    await sftpService.startUpload(sessionId, payload.uploadId, payload.remotePath, payload.size, relativePath, prepareId);
}

export async function handleSftpUploadPrepare(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    const prepareId = payload?.prepareId;

    if (!sessionId || !state) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sftp:upload:prepare:error', payload: { prepareId, message: '无效的会话' } }));
        }
        return;
    }
    if (!prepareId || typeof payload?.basePath !== 'string' || !Array.isArray(payload?.directories)) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sftp:upload:prepare:error', payload: { prepareId, message: '上传路径准备参数无效' } }));
        }
        return;
    }

    try {
        const result = await sftpService.prepareUploadDirectories(
            sessionId,
            prepareId,
            payload.basePath,
            payload.directories,
        );
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'sftp:upload:prepare:ready',
                payload: { prepareId, ...result },
            }));
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

export async function handleSftpUploadChunk(ws: AuthenticatedWebSocket, payload: BinaryUploadChunkPayload): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    if (!sessionId || !state) return;

    if (
        !payload.uploadId
        || !Number.isInteger(payload.chunkIndex)
        || payload.chunkIndex < 0
        || typeof payload.isLast !== 'boolean'
        || !Buffer.isBuffer(payload.data)
    ) {
        console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效二进制上传分块。`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload.uploadId, message: '二进制上传分块格式无效' } }));
        }
        return;
    }
    await sftpService.handleUploadChunk(
        sessionId,
        payload.uploadId,
        payload.chunkIndex,
        payload.data,
        payload.isLast,
    );
}

export async function handleSftpUploadCancel(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    if (!sessionId || !state) return; // Silently ignore

     if (!payload?.uploadId) {
        console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:cancel 请求，但缺少 uploadId。`);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '缺少 uploadId' } }));
        return;
    }
    await sftpService.cancelUpload(sessionId, payload.uploadId);
}
