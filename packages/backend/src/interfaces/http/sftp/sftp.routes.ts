import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router, type Response } from 'express';
import type {
  WorkspaceFilesystemService,
  WorkspaceFilesystemTarget,
} from '../../../modules/workspace/services/workspace-filesystem.service';
import { isRemoteFileMissingError } from '../../../platform/filesystem/remote-filesystem';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, requestIp } from '../shared/http-utils';
import { route } from '../shared/route-handler';
import {
  DOWNLOAD_TICKET_TTL_SECONDS,
  DownloadTicketCapacityError,
  DownloadTicketRegistry,
  type DownloadTicketLease,
} from './download-ticket.registry';

const tickets = new DownloadTicketRegistry();
const MAX_INLINE_PREVIEW_SIZE = 20 * 1024 * 1024;
const INLINE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
type ByteRange = { start: number; end: number } | null | 'invalid';
const parseRange = (header: string | undefined, size: number): ByteRange => {
  if (!header) return null;
  if (size <= 0 || header.includes(',')) return 'invalid';
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'invalid';
  if (!m[1]) {
    const len = Number(m[2]);
    if (!Number.isSafeInteger(len) || len <= 0) return 'invalid';
    return { start: Math.max(0, size - len), end: size - 1 };
  }
  const start = Number(m[1]),
    requested = m[2] ? Number(m[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start >= size ||
    !Number.isSafeInteger(requested) ||
    requested < start
  )
    return 'invalid';
  return { start, end: Math.min(requested, size - 1) };
};
const disposition = (kind: 'inline' | 'attachment', remotePath: string) => {
  const filename = path.posix.basename(remotePath),
    fallback = filename.replace(/["\\\r\n]/g, '_').replace(/[^\x20-\x7E]/g, '_') || 'download',
    encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

const archiveDirectory = async (
  service: WorkspaceFilesystemService,
  target: WorkspaceFilesystemTarget,
  remotePath: string,
  response: Response,
) => {
  let name = path.posix.basename(remotePath.replace(/\/$/, ''));
  if (!name || name === '/') name = 'download';
  response.type('application/zip');
  response.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
  const handle = await service.createDirectoryArchive(target.workspaceId, remotePath);
  let finished = false;
  response.once('finish', () => {
    finished = true;
  });
  response.once('close', () => {
    if (!finished && !response.writableEnded) handle.cancel();
  });
  await Promise.all([pipeline(handle.stream, response), handle.start()]);
};

export const createSftpRouter = (filesystem: WorkspaceFilesystemService): Router => {
  const router = Router();
  router.post(
    '/download-ticket',
    requireAuthenticated,
    route(async (request, response) => {
      const userId = request.session.userId!,
        connectionId = Number(request.body?.connectionId),
        workspaceId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : undefined,
        remotePath = typeof request.body?.remotePath === 'string' ? request.body.remotePath : '';
      if (!Number.isSafeInteger(connectionId) || connectionId <= 0 || !remotePath) {
        response.status(400).json({ message: '缺少或无效的下载参数。' });
        return;
      }
      const target = await filesystem.resolveActive(userId, connectionId, workspaceId);
      if (!target) {
        response.status(404).json({ message: '未找到指定的活动 SFTP 会话。' });
        return;
      }
      try {
        const meta = await target.filesystem.metadata(remotePath, { followSymbolicLinks: true });
        if (!meta.isFile) {
          response.status(400).json({ message: '短时下载票据仅支持文件。' });
          return;
        }
        const { token } = tickets.issue({
          userId,
          connectionId,
          workspaceId: target.workspaceId,
          remotePath,
          fileSize: meta.size,
          fileMtime: Math.floor(meta.modifiedAt / 1000),
        });
        response.setHeader('Cache-Control', 'private, no-store');
        response.status(201).json({
          url: `/api/v1/sftp/download?ticket=${encodeURIComponent(token)}`,
          expiresInSeconds: DOWNLOAD_TICKET_TTL_SECONDS,
        });
      } catch (error) {
        if (error instanceof DownloadTicketCapacityError) {
          response.status(429).json({ message: error.message });
          return;
        }
        response
          .status(isRemoteFileMissingError(error) ? 404 : 500)
          .json({ message: isRemoteFileMissingError(error) ? '远程文件未找到。' : '创建下载票据失败。' });
      }
    }),
  );

  const download = route(async (request, response) => {
    let lease: DownloadTicketLease | undefined;
    let userId: number,
      connectionId: number,
      workspaceId: string | undefined,
      remotePath: string,
      kind: 'inline' | 'attachment';
    const token = typeof request.query.ticket === 'string' ? request.query.ticket : undefined;
    if (token) {
      const claim = tickets.claim(token, requestIp(request));
      if (claim.status === 'gone') {
        response.status(410).json({ message: '下载链接已失效。' });
        return;
      }
      if (claim.status === 'locked') {
        response.status(423).json({ message: '下载链接正在由其他来源使用。' });
        return;
      }
      lease = claim.lease;
      userId = lease.userId;
      connectionId = lease.connectionId;
      workspaceId = lease.workspaceId;
      remotePath = lease.remotePath;
      kind = 'attachment';
      let released = false;
      const release = () => {
        if (!released && lease) {
          released = true;
          tickets.releaseRequest(lease);
        }
      };
      response.once('finish', release);
      response.once('close', release);
    } else {
      if (!request.session.userId) {
        response.status(401).json({ message: '未授权：需要登录。' });
        return;
      }
      userId = request.session.userId;
      connectionId = Number(request.query.connectionId);
      workspaceId = typeof request.query.sessionId === 'string' ? request.query.sessionId : undefined;
      remotePath = typeof request.query.remotePath === 'string' ? request.query.remotePath : '';
      kind = request.query.disposition === 'inline' ? 'inline' : 'attachment';
      if (!Number.isSafeInteger(connectionId) || connectionId <= 0 || !remotePath) {
        response.status(400).json({ message: '缺少或无效的查询参数。' });
        return;
      }
    }
    const target = await filesystem.resolveActive(userId, connectionId, workspaceId);
    if (!target) {
      response.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
      return;
    }
    try {
      const meta = await target.filesystem.metadata(remotePath, { followSymbolicLinks: true });
      if (lease && (meta.size !== lease.fileSize || Math.floor(meta.modifiedAt / 1000) !== lease.fileMtime)) {
        tickets.invalidate(lease);
        response.status(410).json({ message: '远程文件已变化，请重新发起下载。' });
        return;
      }
      if (meta.isDirectory) {
        if (lease) {
          tickets.invalidate(lease);
          response.status(410).json({ message: '下载链接对应的文件已变化。' });
          return;
        }
        await archiveDirectory(filesystem, target, remotePath, response);
        return;
      }
      if (!meta.isFile) {
        response.status(400).json({ message: '指定的路径不是一个文件。' });
        return;
      }
      if (kind === 'inline' && meta.size > MAX_INLINE_PREVIEW_SIZE) {
        response.status(413).json({ message: '文件过大，无法进行内联预览。' });
        return;
      }
      const range = parseRange(request.headers.range, meta.size);
      if (range === 'invalid') {
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Content-Range', `bytes */${meta.size}`);
        response.status(416).end();
        return;
      }
      response.setHeader('Content-Disposition', disposition(kind, remotePath));
      response.setHeader(
        'Content-Type',
        kind === 'inline'
          ? (INLINE_TYPES[path.posix.extname(remotePath).toLowerCase()] ?? 'application/octet-stream')
          : 'application/octet-stream',
      );
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        response.status(206);
        response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${meta.size}`);
        response.setHeader('Content-Length', String(range.end - range.start + 1));
      } else {
        response.status(200);
        response.setHeader('Content-Length', String(meta.size));
      }
      if (request.method === 'HEAD') {
        response.end();
        if (lease) tickets.complete(lease);
        return;
      }
      const stream = await target.filesystem.openRead(remotePath, range || undefined);
      if (lease) tickets.attachStream(lease, stream);
      response.once('close', () => {
        if (!response.writableEnded && !stream.destroyed) stream.destroy();
      });
      await pipeline(stream, response);
      if (lease) tickets.complete(lease);
    } catch (error) {
      if (!response.headersSent) {
        if (lease && isRemoteFileMissingError(error)) tickets.invalidate(lease);
        response.status(isRemoteFileMissingError(error) ? 404 : 500).json({
          message: isRemoteFileMissingError(error) ? '远程文件未找到。' : `处理下载请求时出错: ${errorMessage(error)}`,
        });
      } else if (!response.writableEnded) response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });
  router.get('/download', download);
  router.head('/download', download);
  router.get(
    '/download-directory',
    requireAuthenticated,
    route(async (request, response) => {
      const userId = request.session.userId!,
        connectionId = Number(request.query.connectionId),
        workspaceId = typeof request.query.sessionId === 'string' ? request.query.sessionId : undefined,
        remotePath = typeof request.query.remotePath === 'string' ? request.query.remotePath : '';
      if (!Number.isSafeInteger(connectionId) || connectionId <= 0 || !remotePath) {
        response.status(400).json({ message: '缺少或无效的查询参数。' });
        return;
      }
      const target = await filesystem.resolveActive(userId, connectionId, workspaceId);
      if (!target) {
        response.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
        return;
      }
      try {
        const meta = await target.filesystem.metadata(remotePath, { followSymbolicLinks: true });
        if (!meta.isDirectory) {
          response.status(400).json({ message: '指定的路径不是一个目录。' });
          return;
        }
        await archiveDirectory(filesystem, target, remotePath, response);
      } catch (error) {
        if (!response.headersSent)
          response
            .status(isRemoteFileMissingError(error) ? 404 : 500)
            .json({ message: isRemoteFileMissingError(error) ? '远程目录未找到。' : errorMessage(error) });
      }
    }),
  );
  return router;
};
