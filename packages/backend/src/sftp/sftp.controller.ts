import { Request, Response } from 'express';
import path from 'path';
import type { Readable } from 'node:stream';
import { clientStates, sftpService } from '../websocket/state';
import { Archiver, ZipArchive } from 'archiver';
import { SFTPWrapper, Stats } from 'ssh2';
import { WebSocket } from 'ws';
import { ClientState, AuthenticatedWebSocket } from '../websocket/types';
import {
  SftpCompressRequestPayload,
  SftpDecompressRequestPayload,
  SftpCompressSuccessPayload,
  SftpCompressErrorPayload,
  SftpDecompressSuccessPayload,
  SftpDecompressErrorPayload,
} from '../websocket/types'; // Import payload types
import { quotePosixShellArg } from '../utils/shell';
import {
  DOWNLOAD_TICKET_TTL_SECONDS,
  attachDownloadStream,
  claimDownloadTicket,
  completeDownloadTicket,
  invalidateDownloadTicket,
  issueDownloadTicket,
  recordCompletedRange,
  type DownloadTicketLease,
} from './download-ticket';

const pendingSftpInitializations = new Map<string, Promise<void>>();

const getSftpStats = (sftp: SFTPWrapper, remotePath: string): Promise<Stats> =>
  new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) return reject(err);
      resolve(stats);
    });
  });

const getSftpRealPath = (sftp: SFTPWrapper, remotePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    sftp.realpath(remotePath, (err, resolvedPath) => {
      if (err) return reject(err);
      resolve(resolvedPath);
    });
  });

const readSftpDirectory = (sftp: SFTPWrapper, remotePath: string): Promise<any[]> =>
  new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, entries) => {
      if (err) return reject(err);
      resolve(entries);
    });
  });

const addDirectoryToArchive = async (
  sftp: SFTPWrapper,
  archive: Archiver,
  remotePath: string,
  archivePath: string,
  ancestorRealPaths: ReadonlySet<string> = new Set(),
  activeStreams: Set<Readable> = new Set(),
  isAborted: () => boolean = () => false,
): Promise<void> => {
  if (isAborted()) return;
  const realPath = await getSftpRealPath(sftp, remotePath);
  if (isAborted()) return;
  if (ancestorRealPaths.has(realPath)) {
    console.warn(`SFTP 归档：跳过循环软链接 ${remotePath} -> ${realPath}`);
    return;
  }

  const nextAncestors = new Set(ancestorRealPaths);
  nextAncestors.add(realPath);
  const entries = await readSftpDirectory(sftp, remotePath);
  if (isAborted()) return;

  for (const entry of entries) {
    if (isAborted()) return;
    const currentRemotePath = path.posix.join(remotePath, entry.filename);
    const currentArchivePath = path.posix.join(archivePath, entry.filename);
    const targetStats: Stats = entry.attrs.isSymbolicLink() ? await getSftpStats(sftp, currentRemotePath) : entry.attrs;

    if (targetStats.isDirectory()) {
      archive.append(Buffer.alloc(0), { name: `${currentArchivePath}/` });
      await addDirectoryToArchive(
        sftp,
        archive,
        currentRemotePath,
        currentArchivePath,
        nextAncestors,
        activeStreams,
        isAborted,
      );
    } else if (targetStats.isFile()) {
      const fileStream = sftp.createReadStream(currentRemotePath);
      activeStreams.add(fileStream);
      const forgetStream = () => activeStreams.delete(fileStream);
      fileStream.once('end', forgetStream);
      fileStream.once('close', forgetStream);
      fileStream.on('error', (streamError: Error) => {
        forgetStream();
        console.error(`SFTP 归档：读取 ${currentRemotePath} 失败:`, streamError);
        archive.emit('error', streamError);
      });
      archive.append(fileStream, { name: currentArchivePath });
    }
  }
};

const streamDirectoryArchive = async (
  sftp: SFTPWrapper,
  remotePath: string,
  userId: number,
  res: Response,
): Promise<void> => {
  let baseName = path.posix.basename(remotePath.replace(/\/$/, ''));
  if (!baseName || baseName === '/') baseName = 'download';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const activeStreams = new Set<Readable>();
  let completed = false;
  let aborted = false;
  const abortDownload = () => {
    if (completed || aborted) return;
    aborted = true;
    for (const stream of activeStreams) stream.destroy();
    activeStreams.clear();
    archive.abort();
  };
  res.once('close', () => {
    if (!res.writableEnded) abortDownload();
  });
  res.once('finish', () => {
    completed = true;
  });
  archive.on('warning', (err: Error) => {
    console.warn(`Archiver warning (用户 ${userId}, 路径 ${remotePath}):`, err);
  });
  archive.on('error', (err: Error) => {
    console.error(`Archiver error (用户 ${userId}, 路径 ${remotePath}):`, err);
    if (!res.headersSent) {
      res.status(500).json({ message: `创建压缩文件时出错: ${err.message}` });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  archive.pipe(res);

  await addDirectoryToArchive(sftp, archive, remotePath, '', new Set(), activeStreams, () => aborted);
  if (!aborted) await archive.finalize();
};

const ensureSftpReady = async (sessionId: string, state: ClientState): Promise<boolean> => {
  if (state.sftp) return true;
  if (!state.sshClient) return false;

  let pending = pendingSftpInitializations.get(sessionId);
  if (!pending) {
    pending = sftpService.initializeSftpSession(sessionId);
    pendingSftpInitializations.set(sessionId, pending);
  }
  try {
    await pending;
  } catch (error) {
    console.error(`SFTP 下载：重建会话 ${sessionId} 失败:`, error);
  } finally {
    if (pendingSftpInitializations.get(sessionId) === pending) {
      pendingSftpInitializations.delete(sessionId);
    }
  }
  return Boolean(state.sftp);
};

const resolveDownloadTarget = async (
  userId: number,
  connectionId: number,
  requestedSessionId?: string,
): Promise<{ sessionId: string; state: ClientState } | null> => {
  if (requestedSessionId) {
    const exactState = clientStates.get(requestedSessionId);
    if (exactState?.ws.userId === userId && exactState.dbConnectionId === connectionId) {
      if (await ensureSftpReady(requestedSessionId, exactState)) {
        return { sessionId: requestedSessionId, state: exactState };
      }
    }
  }

  for (const [sessionId, state] of clientStates.entries()) {
    if (state.ws.userId !== userId || state.dbConnectionId !== connectionId) continue;
    if (state.sftp || await ensureSftpReady(sessionId, state)) {
      return { sessionId, state };
    }
  }
  return null;
};

interface SftpDownloadQuery {
  connectionId?: string;
  sessionId?: string;
  remotePath?: string;
  disposition?: 'inline' | 'attachment';
  ticket?: string;
}

interface CreateDownloadTicketBody {
  connectionId?: string | number;
  sessionId?: string;
  remotePath?: string;
}

type ParsedByteRange = { start: number; end: number } | null | 'invalid';

const parseByteRange = (rangeHeader: string | undefined, fileSize: number): ParsedByteRange => {
  if (!rangeHeader) return null;
  if (fileSize <= 0 || rangeHeader.includes(',')) return 'invalid';
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return 'invalid';

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'invalid';

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    const start = Math.max(0, fileSize - suffixLength);
    return { start, end: fileSize - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize) return 'invalid';
  const requestedEnd = rawEnd ? Number(rawEnd) : fileSize - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return 'invalid';
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
};

const inlineContentTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const MAX_INLINE_PREVIEW_SIZE = 20 * 1024 * 1024;

const encodeContentDispositionFilename = (filename: string): string =>
  encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const getContentDisposition = (disposition: 'inline' | 'attachment', remotePath: string): string => {
  const filename = path.basename(remotePath);
  const asciiFallback = filename.replace(/["\\\r\n]/g, '_').replace(/[^\x20-\x7E]/g, '_') || 'download';
  const encodedFilename = encodeContentDispositionFilename(filename);

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
};

export const createDownloadTicket = async (
  req: Request<object, object, CreateDownloadTicketBody>,
  res: Response,
): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ message: '未授权：需要登录。' });
    return;
  }

  const connectionId = Number(req.body.connectionId);
  const remotePath = typeof req.body.remotePath === 'string' ? req.body.remotePath : '';
  const requestedSessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId : undefined;
  if (!Number.isSafeInteger(connectionId) || connectionId <= 0 || !remotePath) {
    res.status(400).json({ message: '缺少或无效的下载参数。' });
    return;
  }

  const target = await resolveDownloadTarget(userId, connectionId, requestedSessionId);
  if (!target?.state.sftp) {
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。' });
    return;
  }

  try {
    const stats = await getSftpStats(target.state.sftp, remotePath);
    if (!stats.isFile()) {
      res.status(400).json({ message: '短时下载票据仅支持文件。' });
      return;
    }

    const { token } = issueDownloadTicket({
      userId,
      connectionId,
      sessionId: target.sessionId,
      remotePath,
      fileSize: stats.size,
      fileMtime: stats.mtime,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(201).json({
      url: `/api/v1/sftp/download?ticket=${encodeURIComponent(token)}`,
      expiresInSeconds: DOWNLOAD_TICKET_TTL_SECONDS,
    });
  } catch (error: any) {
    console.error(`SFTP 下载票据创建失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    res.status(error.message?.includes('No such file') ? 404 : 500).json({
      message: error.message?.includes('No such file') ? '远程文件未找到。' : '创建下载票据失败。',
    });
  }
};

/**
 * 处理文件下载请求 (GET /api/v1/sftp/download)
 */
export const downloadFile = async (
  req: Request<object, object, object, SftpDownloadQuery>,
  res: Response,
): Promise<void> => {
  let lease: DownloadTicketLease | null = null;
  let userId: number;
  let targetDbConnectionId: number;
  let requestedSessionId: string | undefined;
  let remotePath: string;
  let disposition: 'inline' | 'attachment';

  if (req.query.ticket) {
    const claim = claimDownloadTicket(req.query.ticket, req.ip || req.socket.remoteAddress || 'unknown');
    if (claim.status === 'gone') {
      res.status(410).json({ message: '下载链接已失效。' });
      return;
    }
    if (claim.status === 'locked') {
      res.status(423).json({ message: '下载链接正在由其他来源使用。' });
      return;
    }
    lease = claim.lease;
    userId = lease.userId;
    targetDbConnectionId = lease.connectionId;
    requestedSessionId = lease.sessionId;
    remotePath = lease.remotePath;
    disposition = 'attachment';
  } else {
    const authenticatedUserId = req.session.userId;
    const connectionId = req.query.connectionId;
    const requestedRemotePath = req.query.remotePath;
    if (!authenticatedUserId) {
      res.status(401).json({ message: '未授权：需要登录。' });
      return;
    }
    if (!connectionId || !requestedRemotePath) {
      res.status(400).json({ message: '缺少必要的查询参数 (connectionId, remotePath)。' });
      return;
    }
    targetDbConnectionId = Number(connectionId);
    if (!Number.isSafeInteger(targetDbConnectionId) || targetDbConnectionId <= 0) {
      res.status(400).json({ message: '无效的 connectionId。' });
      return;
    }
    userId = authenticatedUserId;
    requestedSessionId = req.query.sessionId;
    remotePath = requestedRemotePath;
    disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
  }

  const target = await resolveDownloadTarget(userId, targetDbConnectionId, requestedSessionId);
  if (!target?.state.sftp) {
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }
  const userSftpSession = target.state.sftp;

  try {
    const stats = await getSftpStats(userSftpSession, remotePath);

    if (lease && (stats.size !== lease.fileSize || stats.mtime !== lease.fileMtime)) {
      invalidateDownloadTicket(lease);
      res.status(410).json({ message: '远程文件已变化，请重新发起下载。' });
      return;
    }

    if (stats.isDirectory()) {
      if (lease) {
        invalidateDownloadTicket(lease);
        res.status(410).json({ message: '下载链接对应的文件已变化。' });
        return;
      }
      await streamDirectoryArchive(userSftpSession, remotePath, userId, res);
      return;
    }

    if (!stats.isFile()) {
      if (lease) invalidateDownloadTicket(lease);
      res.status(400).json({ message: '指定的路径不是一个文件。' });
      return;
    }

    if (disposition === 'inline' && stats.size > MAX_INLINE_PREVIEW_SIZE) {
      res.status(413).json({ message: '文件过大，无法进行内联预览。' });
      return;
    }

    const range = parseByteRange(req.headers.range, stats.size);
    if (range === 'invalid') {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes */${stats.size}`);
      res.status(416).end();
      return;
    }

    const extension = path.extname(remotePath).toLowerCase();
    const contentType = disposition === 'inline'
      ? (inlineContentTypes[extension] ?? 'application/octet-stream')
      : 'application/octet-stream';
    res.setHeader('Content-Disposition', getContentDisposition(disposition, remotePath));
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(stats.size));
    }

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const readStream = range
      ? userSftpSession.createReadStream(remotePath, { start: range.start, end: range.end })
      : userSftpSession.createReadStream(remotePath);
    if (lease) attachDownloadStream(lease, readStream);

    let streamFailed = false;
    readStream.on('error', (err: Error) => {
      streamFailed = true;
      console.error(`SFTP 读取流错误 (用户 ${userId}, 路径 ${remotePath}):`, err);
      if (!res.headersSent) {
        res.status(500).end();
      } else if (!res.writableEnded) {
        res.end();
      }
    });

    res.once('finish', () => {
      if (!lease || streamFailed) return;
      if (range) recordCompletedRange(lease, range.start, range.end);
      else completeDownloadTicket(lease);
    });
    res.once('close', () => {
      if (!res.writableEnded && !readStream.destroyed) readStream.destroy();
    });

    readStream.pipe(res);
  } catch (error: any) {
    console.error(`SFTP 下载处理失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) {
      const notFound = error.message?.includes('No such file');
      if (lease && notFound) invalidateDownloadTicket(lease);
      res.status(notFound ? 404 : 500).json({
        message: notFound ? '远程文件未找到。' : `处理下载请求时出错: ${error.message}`,
      });
    }
  }
};

/**
 * 处理文件夹下载请求 (GET /api/v1/sftp/download-directory)
 */
export const downloadDirectory = async (
  req: Request<object, object, object, SftpDownloadQuery>,
  res: Response,
): Promise<void> => {
  const userId = req.session.userId;
  const connectionId = req.query.connectionId;
  const requestedSessionId = req.query.sessionId;
  const remotePath = req.query.remotePath;

  // 参数验证
  if (!userId) {
    res.status(401).json({ message: '未授权：需要登录。' });
    return;
  }
  if (!connectionId || !remotePath) {
    res.status(400).json({ message: '缺少必要的查询参数 (connectionId, remotePath)。' });
    return;
  }

  console.log(`SFTP 文件夹下载请求：用户 ${userId}, 连接 ${connectionId}, 路径 ${remotePath}`);

  // --- 修改：查找与 userId 和 connectionId 匹配的活动 SFTP 会话 ---
  let targetState: ClientState | null = null;
  const targetDbConnectionId = parseInt(connectionId, 10); // 将查询参数字符串转换为数字

  if (isNaN(targetDbConnectionId)) {
    res.status(400).json({ message: '无效的 connectionId。' });
    return;
  }

  console.log(`SFTP 文件夹下载：正在查找用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的会话...`);
  if (requestedSessionId) {
    const exactState = clientStates.get(requestedSessionId);
    if (exactState?.ws.userId === userId && exactState.dbConnectionId === targetDbConnectionId) {
      await ensureSftpReady(requestedSessionId, exactState);
      targetState = exactState;
    }
  }
  for (const [sessionId, state] of clientStates.entries()) {
    if (targetState) break;
    // 检查 userId 和 dbConnectionId 是否都匹配，并且 sftp 实例存在
    if (state.ws.userId === userId && state.dbConnectionId === targetDbConnectionId && state.sftp) {
      targetState = state;
      console.log(`SFTP 文件夹下载：找到匹配的会话 (Session ID: ${sessionId})。`);
      break;
    }
  }

  if (!targetState || !targetState.sftp) {
    console.warn(`SFTP 文件夹下载失败：未找到用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的活动 SFTP 会话。`);
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }

  const userSftpSession = targetState.sftp; // 获取正确的 SFTP 实例

  try {
    // 跟随软链接验证目标是否为目录
    const stats = await getSftpStats(userSftpSession, remotePath);

    if (!stats.isDirectory()) {
      res.status(400).json({ message: '指定的路径不是一个目录。' });
      return;
    }

    await streamDirectoryArchive(userSftpSession, remotePath, userId, res);

    console.log(`SFTP 文件夹下载完成 (用户 ${userId}, 路径 ${remotePath})`);
  } catch (error: any) {
    console.error(`SFTP 文件夹下载处理失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) {
      if (error.code === 'ENOENT' || error.message?.includes('No such file')) {
        // 检查 SFTP 错误码或消息
        res.status(404).json({ message: '远程目录未找到。' });
      } else {
        res.status(500).json({ message: `处理文件夹下载请求时出错: ${error.message}` });
      }
    } else {
      res.end(); // 如果头已发送，尝试结束响应
    }
  }
};

// --- WebSocket Message Handlers (to be called by WebSocket router) ---

/**
 * 发送通用 WebSocket 错误消息的辅助函数
 */
const sendWebSocketError = (
  ws: AuthenticatedWebSocket | undefined,
  type: string,
  message: string,
  requestId: string,
  details?: any,
) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload: { error: message, details, requestId } }));
  } else {
    console.warn(
      `WebSocket closed or invalid, cannot send error for request ${requestId}. Type: ${type}, Message: ${message}`,
    );
  }
};

/**
 * 发送压缩错误消息
 */
const sendCompressError = (
  ws: AuthenticatedWebSocket | undefined,
  error: string,
  requestId: string,
  details?: string,
) => {
  const payload: SftpCompressErrorPayload = { error, requestId };
  if (details) payload.details = details;
  sendWebSocketError(ws, 'sftp:compress:error', error, requestId, payload);
};

/**
 * 发送解压错误消息
 */
const sendDecompressError = (
  ws: AuthenticatedWebSocket | undefined,
  error: string,
  requestId: string,
  details?: string,
) => {
  const payload: SftpDecompressErrorPayload = { error, requestId };
  if (details) payload.details = details;
  sendWebSocketError(ws, 'sftp:decompress:error', error, requestId, payload);
};

/**
 * 检查 stderr 输出是否包含表示错误的常见模式 (从 SftpService 复制过来)
 */
const isErrorInStdErr = (stderr: string): boolean => {
  if (!stderr || stderr.trim().length === 0) {
    return false; // 空 stderr 不是错误
  }
  const lowerStderr = stderr.toLowerCase();
  // 常见的错误关键词或模式
  const errorPatterns = [
    'error',
    'fail',
    'cannot',
    'not found',
    'no such file',
    'permission denied',
    'invalid',
    '不支持',
  ];
  // tar/zip 进度信息通常包含百分比或文件名，不应视为错误
  if (
    /[\d.]+%/.test(stderr) ||
    /adding:/.test(lowerStderr) ||
    /inflating:/.test(lowerStderr) ||
    /extracting:/.test(lowerStderr)
  ) {
    // 忽略一些明确的非错误输出
    if (errorPatterns.some((pattern) => lowerStderr.includes(pattern))) {
      // 如果进度信息中包含错误关键词，则可能真的是错误
      return true;
    }
    return false;
  }

  return errorPatterns.some((pattern) => lowerStderr.includes(pattern));
};

/**
 * 处理 'sftp:compress' WebSocket 消息
 * @param ws WebSocket 连接实例
 * @param payload 消息负载
 */
export const handleCompressRequest = async (
  ws: AuthenticatedWebSocket,
  payload: SftpCompressRequestPayload,
): Promise<void> => {
  const { sources, destinationArchiveName, format, targetDirectory, requestId } = payload;
  const sessionId = ws.sessionId; // 从 AuthenticatedWebSocket 获取 sessionId

  if (!sessionId) {
    console.error(`[WS SFTP Compress] Missing sessionId on WebSocket for request (ID: ${requestId}).`);
    sendCompressError(ws, '内部错误：缺少会话 ID', requestId);
    return;
  }

  const state = clientStates.get(sessionId);

  console.log(`[WS SFTP Compress ${sessionId}] Received request (ID: ${requestId}).`);

  if (!state || !state.sshClient) {
    console.warn(`[WS SFTP Compress ${sessionId}] SSH client not ready (ID: ${requestId})`);
    sendCompressError(ws, 'SSH 会话未就绪', requestId);
    return;
  }

  console.debug(
    `[WS SFTP Compress ${sessionId}] Processing compress request (ID: ${requestId}). Sources: ${sources.join(', ')}, Dest: ${destinationArchiveName}, Format: ${format}, Dir: ${targetDirectory}`,
  );

  // 构建目标压缩包的完整路径 (使用 posix 风格)
  const destinationArchivePath = path.posix.join(targetDirectory, destinationArchiveName);

  // --- 构建 Shell 命令 ---
  let command: string;
  // 确保源路径被正确引用，特别是包含空格或特殊字符时
  // 注意：源路径是相对于 targetDirectory 的
  const quotedSources = sources
    .map((source) => (source.startsWith('-') ? `./${source}` : source))
    .map(quotePosixShellArg)
    .join(' ');
  // 确保目标目录和压缩包名称被正确引用
  const quotedTargetDir = quotePosixShellArg(targetDirectory);
  const quotedDestName = quotePosixShellArg(
    destinationArchiveName.startsWith('-') ? `./${destinationArchiveName}` : destinationArchiveName,
  );

  const cdCommand = `cd ${quotedTargetDir}`;

  switch (format) {
    case 'zip':
      // zip -r [归档名] [源文件/目录列表]
      command = `${cdCommand} && zip -qr ${quotedDestName} ${quotedSources}`; // -q for quiet to reduce stderr noise
      break;
    case 'targz':
      // tar -czvf [归档名] [源文件/目录列表]
      command = `${cdCommand} && tar -czf ${quotedDestName} ${quotedSources}`; // removed -v for less noise
      break;
    case 'tarbz2':
      // tar -cjvf [归档名] [源文件/目录列表]
      command = `${cdCommand} && tar -cjf ${quotedDestName} ${quotedSources}`; // removed -v for less noise
      break;
    default:
      sendCompressError(ws, `不支持的压缩格式: ${format}`, requestId);
      return;
  }

  console.log(`[WS SFTP Compress ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

  // --- 执行命令 ---
  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        console.error(`[WS SFTP Compress ${sessionId}] Failed to start exec (ID: ${requestId}):`, err);
        sendCompressError(ws, `执行压缩命令失败: ${err.message}`, requestId);
        return;
      }

      let stderrData = '';
      let stdoutData = ''; // Capture stdout for debugging if needed
      let exitCode: number | null = null;

      stream.on('data', (data: Buffer) => {
        stdoutData += data.toString();
        // console.debug(`[WS SFTP Compress ${sessionId}] stdout: ${data}`);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
        console.debug(`[WS SFTP Compress ${sessionId}] stderr: ${data}`); // Log stderr for debugging
      });

      stream.on('close', (code: number | null) => {
        exitCode = code;
        console.log(
          `[WS SFTP Compress ${sessionId}] Command finished with code ${exitCode} (ID: ${requestId}). Stderr length: ${stderrData.length}`,
        );
        if (exitCode === 0 && !isErrorInStdErr(stderrData)) {
          console.log(`[WS SFTP Compress ${sessionId}] Compression successful (ID: ${requestId}).`);
          const successPayload: SftpCompressSuccessPayload = {
            message: '压缩成功',
            requestId: requestId,
            // Optionally add archive path or details here
            // archivePath: destinationArchivePath
          };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sftp:compress:success', payload: successPayload }));
          }
        } else {
          const errorDetails = stderrData.trim() || `压缩命令退出，代码: ${exitCode ?? 'N/A'}`;
          console.error(`[WS SFTP Compress ${sessionId}] Compression failed (ID: ${requestId}): ${errorDetails}`);
          sendCompressError(ws, '压缩失败', requestId, errorDetails);
        }
      });

      stream.on('error', (streamErr: Error) => {
        console.error(`[WS SFTP Compress ${sessionId}] Command stream error (ID: ${requestId}):`, streamErr);
        // Avoid sending duplicate errors if 'close' already indicated failure
        if (exitCode === null) {
          sendCompressError(ws, '压缩命令流错误', requestId, streamErr.message);
        }
      });
    });
  } catch (execError: any) {
    console.error(`[WS SFTP Compress ${sessionId}] Unexpected error setting up exec (ID: ${requestId}):`, execError);
    sendCompressError(ws, `执行压缩时发生意外错误: ${execError.message}`, requestId);
  }
};

/**
 * 处理 'sftp:decompress' WebSocket 消息
 * @param ws WebSocket 连接实例
 * @param payload 消息负载
 */
export const handleDecompressRequest = async (
  ws: AuthenticatedWebSocket,
  payload: SftpDecompressRequestPayload,
): Promise<void> => {
  const { archivePath, requestId } = payload;
  const sessionId = ws.sessionId;

  if (!sessionId) {
    console.error(`[WS SFTP Decompress] Missing sessionId on WebSocket for request (ID: ${requestId}).`);
    sendDecompressError(ws, '内部错误：缺少会话 ID', requestId);
    return;
  }

  const state = clientStates.get(sessionId);

  console.log(`[WS SFTP Decompress ${sessionId}] Received request for ${archivePath} (ID: ${requestId}).`);

  if (!state || !state.sshClient) {
    console.warn(`[WS SFTP Decompress ${sessionId}] SSH client not ready (ID: ${requestId})`);
    sendDecompressError(ws, 'SSH 会话未就绪', requestId);
    return;
  }

  console.debug(
    `[WS SFTP Decompress ${sessionId}] Processing decompress request for ${archivePath} (ID: ${requestId})`,
  );

  const extractDir = path.posix.dirname(archivePath);
  const archiveBasename = path.posix.basename(archivePath);
  const safeArchiveArgument = archiveBasename.startsWith('-') ? `./${archiveBasename}` : archiveBasename;

  // --- 构建 Shell 命令 ---
  let command: string;
  // 确保路径被正确引用
  const quotedExtractDir = quotePosixShellArg(extractDir);
  const quotedArchiveBasename = quotePosixShellArg(safeArchiveArgument);

  const cdCommand = `cd ${quotedExtractDir}`;

  const lowerArchivePath = archivePath.toLowerCase();

  if (lowerArchivePath.endsWith('.zip')) {
    // unzip -o [压缩包名]
    command = `${cdCommand} && unzip -oq ${quotedArchiveBasename}`; // -o: overwrite, -q: quiet
  } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
    // tar -xzvf [压缩包名]
    command = `${cdCommand} && tar -xzf ${quotedArchiveBasename}`; // removed -v
  } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
    // tar -xjvf [压缩包名]
    command = `${cdCommand} && tar -xjf ${quotedArchiveBasename}`; // removed -v
  } else {
    sendDecompressError(ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
    return;
  }

  console.log(`[WS SFTP Decompress ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

  // --- 执行命令 ---
  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        console.error(`[WS SFTP Decompress ${sessionId}] Failed to start exec (ID: ${requestId}):`, err);
        sendDecompressError(ws, `执行解压命令失败: ${err.message}`, requestId);
        return;
      }

      let stderrData = '';
      let stdoutData = '';
      let exitCode: number | null = null;

      stream.on('data', (data: Buffer) => {
        stdoutData += data.toString();
        // console.debug(`[WS SFTP Decompress ${sessionId}] stdout: ${data}`);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
        console.debug(`[WS SFTP Decompress ${sessionId}] stderr: ${data}`); // Log stderr
      });

      stream.on('close', (code: number | null) => {
        exitCode = code;
        console.log(
          `[WS SFTP Decompress ${sessionId}] Command finished with code ${exitCode} (ID: ${requestId}). Stderr length: ${stderrData.length}`,
        );
        if (exitCode === 0 && !isErrorInStdErr(stderrData)) {
          console.log(`[WS SFTP Decompress ${sessionId}] Decompression successful (ID: ${requestId}).`);
          const successPayload: SftpDecompressSuccessPayload = {
            message: '解压成功',
            requestId: requestId,
            // Optionally add target directory
            // targetDirectory: extractDir
          };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sftp:decompress:success', payload: successPayload }));
          }
        } else {
          const errorDetails = stderrData.trim() || `解压命令退出，代码: ${exitCode ?? 'N/A'}`;
          console.error(`[WS SFTP Decompress ${sessionId}] Decompression failed (ID: ${requestId}): ${errorDetails}`);
          sendDecompressError(ws, '解压失败', requestId, errorDetails);
        }
      });

      stream.on('error', (streamErr: Error) => {
        console.error(`[WS SFTP Decompress ${sessionId}] Command stream error (ID: ${requestId}):`, streamErr);
        if (exitCode === null) {
          sendDecompressError(ws, '解压命令流错误', requestId, streamErr.message);
        }
      });
    });
  } catch (execError: any) {
    console.error(`[WS SFTP Decompress ${sessionId}] Unexpected error setting up exec (ID: ${requestId}):`, execError);
    sendDecompressError(ws, `执行解压时发生意外错误: ${execError.message}`, requestId);
  }
};
