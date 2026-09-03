import { Request, Response } from 'express';
import path from 'path';
import { workspaceFilesystemService } from '../runtime/service-container';
import type { RemoteFileSystem } from '../filesystem/remote-filesystem';
import { isRemoteFileMissingError } from '../filesystem/remote-filesystem';
import { directoryArchiveService } from '../filesystem/directory-archive.service';
import {
  DownloadTicketCapacityError,
  DOWNLOAD_TICKET_TTL_SECONDS,
  attachDownloadStream,
  claimDownloadTicket,
  completeDownloadTicket,
  invalidateDownloadTicket,
  issueDownloadTicket,
  recordCompletedRange,
  releaseDownloadTicketRequest,
  type DownloadTicketLease,
} from './download-ticket';

const streamDirectoryArchive = async (
  filesystem: RemoteFileSystem,
  remotePath: string,
  userId: number,
  res: Response,
): Promise<void> => {
  let baseName = path.posix.basename(remotePath.replace(/\/$/, ''));
  if (!baseName || baseName === '/') baseName = 'download';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);

  const handle = directoryArchiveService.createZip(filesystem, remotePath);
  let completed = false;
  res.once('close', () => {
    if (!completed && !res.writableEnded) handle.cancel();
  });
  res.once('finish', () => { completed = true; });
  handle.archive.on('warning', (error: Error) => {
    console.warn(`Remote archive warning (用户 ${userId}, 路径 ${remotePath}):`, error);
  });
  handle.archive.on('error', (error: Error) => {
    console.error(`Remote archive error (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) res.status(500).json({ message: `创建压缩文件时出错: ${error.message}` });
    else if (!res.writableEnded) res.end();
  });
  handle.archive.pipe(res);
  await handle.start();
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

  const target = await workspaceFilesystemService.resolveActive(userId, connectionId, requestedSessionId);
  if (!target) {
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。' });
    return;
  }

  try {
    const metadata = await target.filesystem.metadata(remotePath, { followSymbolicLinks: true });
    if (!metadata.isFile) {
      res.status(400).json({ message: '短时下载票据仅支持文件。' });
      return;
    }

    const { token } = issueDownloadTicket({
      userId,
      connectionId,
      sessionId: target.sessionId,
      remotePath,
      fileSize: metadata.size,
      fileMtime: Math.floor(metadata.mtime / 1000),
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(201).json({
      url: `/api/v1/sftp/download?ticket=${encodeURIComponent(token)}`,
      expiresInSeconds: DOWNLOAD_TICKET_TTL_SECONDS,
    });
  } catch (error: any) {
    console.error(`SFTP 下载票据创建失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (error instanceof DownloadTicketCapacityError) {
      res.status(429).json({ message: error.message });
      return;
    }
    const notFound = isRemoteFileMissingError(error);
    res.status(notFound ? 404 : 500).json({
      message: notFound ? '远程文件未找到。' : '创建下载票据失败。',
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
    let ticketRequestReleased = false;
    const releaseTicketRequest = () => {
      if (ticketRequestReleased || !lease) return;
      ticketRequestReleased = true;
      releaseDownloadTicketRequest(lease);
    };
    res.once('finish', releaseTicketRequest);
    res.once('close', releaseTicketRequest);
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

  const target = await workspaceFilesystemService.resolveActive(userId, targetDbConnectionId, requestedSessionId);
  if (!target) {
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }
  const filesystem = target.filesystem;

  try {
    const metadata = await filesystem.metadata(remotePath, { followSymbolicLinks: true });

    if (lease && (metadata.size !== lease.fileSize || Math.floor(metadata.mtime / 1000) !== lease.fileMtime)) {
      invalidateDownloadTicket(lease);
      res.status(410).json({ message: '远程文件已变化，请重新发起下载。' });
      return;
    }

    if (metadata.isDirectory) {
      if (lease) {
        invalidateDownloadTicket(lease);
        res.status(410).json({ message: '下载链接对应的文件已变化。' });
        return;
      }
      await streamDirectoryArchive(filesystem, remotePath, userId, res);
      return;
    }

    if (!metadata.isFile) {
      if (lease) invalidateDownloadTicket(lease);
      res.status(400).json({ message: '指定的路径不是一个文件。' });
      return;
    }

    if (disposition === 'inline' && metadata.size > MAX_INLINE_PREVIEW_SIZE) {
      res.status(413).json({ message: '文件过大，无法进行内联预览。' });
      return;
    }

    const range = parseByteRange(req.headers.range, metadata.size);
    if (range === 'invalid') {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes */${metadata.size}`);
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
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${metadata.size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(metadata.size));
    }

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const readStream = await filesystem.openRead(remotePath, range || undefined);
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
      const notFound = isRemoteFileMissingError(error);
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

  const targetDbConnectionId = Number(connectionId);
  if (!Number.isSafeInteger(targetDbConnectionId) || targetDbConnectionId <= 0) {
    res.status(400).json({ message: '无效的 connectionId。' });
    return;
  }

  const target = await workspaceFilesystemService.resolveActive(userId, targetDbConnectionId, requestedSessionId);
  if (!target) {
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }

  try {
    const metadata = await target.filesystem.metadata(remotePath, { followSymbolicLinks: true });
    if (!metadata.isDirectory) {
      res.status(400).json({ message: '指定的路径不是一个目录。' });
      return;
    }

    await streamDirectoryArchive(target.filesystem, remotePath, userId, res);
    console.log(`SFTP 文件夹下载完成 (用户 ${userId}, 路径 ${remotePath})`);
  } catch (error: any) {
    console.error(`SFTP 文件夹下载处理失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) {
      if (isRemoteFileMissingError(error)) res.status(404).json({ message: '远程目录未找到。' });
      else res.status(500).json({ message: `处理文件夹下载请求时出错: ${error.message}` });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};
