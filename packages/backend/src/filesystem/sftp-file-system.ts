import path from 'node:path';
import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
import type { Readable } from 'node:stream';
import { SftpChannelFileSystem } from './sftp-channel-file-system';
import type { ExecutionSession } from '../execution/execution-session';
import type { FileAttributes, FileEntry, FileSearchResult, ReadFileResult, RealPathResult } from './types';
import type { RemoteDirectoryEntry, RemoteFileMetadata, RemoteFileSystem, RemoteReadRange } from './remote-filesystem';

const SEARCH_CONCURRENCY = 8;
const SEARCH_MAX_RESULTS = 500;
const SEARCH_MAX_DIRECTORIES = 5000;
const SEARCH_MAX_QUERY_LENGTH = 256;

/**
 * Reusable remote filesystem facade backed by one ExecutionSession.
 * It contains no WebSocket or UI state and is shared by Workspace and Agent callers.
 */
export class SftpFileSystem implements RemoteFileSystem {
  constructor(private readonly session: ExecutionSession) {}

  async ensureControl(): Promise<SftpChannelFileSystem> {
    if (!this.session.isReady) throw new Error('SSH 会话未就绪');
    return new SftpChannelFileSystem(await this.session.sftp.ensure('control'));
  }

  async metadata(remotePath: string, options?: { followSymbolicLinks?: boolean }): Promise<RemoteFileMetadata> {
    const filesystem = await this.ensureControl();
    const stats = options?.followSymbolicLinks ? await filesystem.stat(remotePath) : await filesystem.lstat(remotePath);
    return SftpChannelFileSystem.toAttributes(stats);
  }

  async resolvePath(remotePath: string): Promise<string> {
    const filesystem = await this.ensureControl();
    return filesystem.realpath(remotePath);
  }

  async readDirectory(remotePath: string): Promise<RemoteDirectoryEntry[]> {
    const filesystem = await this.ensureControl();
    const entries = await filesystem.list(remotePath);
    return entries.map((entry) => ({
      name: entry.filename,
      longname: entry.longname,
      metadata: SftpChannelFileSystem.toAttributes(entry.attrs),
    }));
  }

  async openRead(remotePath: string, range?: RemoteReadRange): Promise<Readable> {
    const filesystem = await this.ensureControl();
    return range
      ? filesystem.channel.createReadStream(remotePath, { start: range.start, end: range.end })
      : filesystem.channel.createReadStream(remotePath);
  }

  async list(remotePath: string): Promise<FileEntry[]> {
    const filesystem = await this.ensureControl();
    const list = await filesystem.list(remotePath);
    return list.map((item) => SftpChannelFileSystem.toFileEntry(item.filename, item.attrs, item.longname));
  }

  async search(rootPath: string, query: string): Promise<FileSearchResult> {
    if (!this.session.isReady) throw new Error('SSH 会话未就绪');
    const normalizedQuery = query.trim().slice(0, SEARCH_MAX_QUERY_LENGTH).toLocaleLowerCase();
    const normalizedRoot = path.posix.resolve('/', rootPath || '/');
    if (!normalizedQuery) return { items: [], truncated: false };

    const filesystem = new SftpChannelFileSystem(await this.session.sftp.ensure('background'));
    const queue = [normalizedRoot];
    const items: FileSearchResult['items'] = [];
    let scannedDirectories = 0;
    let truncated = false;

    while (queue.length > 0 && items.length < SEARCH_MAX_RESULTS) {
      const remaining = SEARCH_MAX_DIRECTORIES - scannedDirectories;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const batch = queue.splice(0, Math.min(SEARCH_CONCURRENCY, remaining));
      scannedDirectories += batch.length;
      const results = await Promise.all(batch.map(async (directory) => {
        try {
          const list = await filesystem.list(directory);
          return { directory, list, error: undefined as Error | undefined };
        } catch (error) {
          return { directory, list: [], error: error instanceof Error ? error : new Error(String(error)) };
        }
      }));

      for (const result of results) {
        if (result.error) {
          if (result.directory === normalizedRoot) throw result.error;
          continue;
        }
        for (const item of result.list) {
          if (item.filename === '.' || item.filename === '..') continue;
          const fullPath = path.posix.join(result.directory, item.filename);
          const relativePath = path.posix.relative(normalizedRoot, fullPath) || item.filename;
          if (item.filename.toLocaleLowerCase().includes(normalizedQuery)) {
            items.push({
              ...SftpChannelFileSystem.toFileEntry(fullPath, item.attrs, item.longname),
              filename: relativePath,
              basename: item.filename,
              relativePath,
              path: fullPath,
            });
            if (items.length >= SEARCH_MAX_RESULTS) {
              truncated = true;
              break;
            }
          }
          if (item.attrs.isDirectory() && !item.attrs.isSymbolicLink()) queue.push(fullPath);
        }
        if (items.length >= SEARCH_MAX_RESULTS) break;
      }
    }
    if (queue.length > 0) truncated = true;
    return { items, truncated };
  }

  async stat(remotePath: string): Promise<FileAttributes> {
    const filesystem = await this.ensureControl();
    return SftpChannelFileSystem.toAttributes(await filesystem.lstat(remotePath));
  }

  async readFile(remotePath: string, requestedEncoding?: string): Promise<ReadFileResult> {
    const filesystem = await this.ensureControl();
    const fileData = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = filesystem.channel.createReadStream(remotePath);
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });

    let encodingUsed = 'utf-8';
    if (requestedEncoding) {
      const normalized = requestedEncoding.toLowerCase().replace(/[^a-z0-9]/g, '');
      encodingUsed = iconv.encodingExists(normalized) ? normalized : 'utf-8';
    } else {
      const detection = jschardet.detect(fileData);
      let detected = (detection.encoding || 'utf-8').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (detected === 'windows1252') detected = 'cp1252';
      if (detected === 'gb2312') detected = 'gbk';
      if (detected === 'utf8' || detected === 'ascii') encodingUsed = 'utf-8';
      else if (['gbk', 'gb2312', 'gb18030', 'big5', 'euctw'].includes(detected)) encodingUsed = 'gb18030';
      else if (iconv.encodingExists(detected)) encodingUsed = detected;
    }
    // Decode once to validate the selected codec. The UI consumes raw bytes and the encoding name.
    iconv.decode(fileData, encodingUsed);
    return { rawContentBase64: fileData.toString('base64'), encodingUsed };
  }

  async writeFile(remotePath: string, content: string, encoding = 'utf-8'): Promise<FileEntry | null> {
    const filesystem = await this.ensureControl();
    const data = iconv.encode(content, encoding);
    let originalMode: number | undefined;
    try {
      originalMode = (await filesystem.lstat(remotePath)).mode;
    } catch {
      // New file: no existing permissions to preserve.
    }

    await new Promise<void>((resolve, reject) => {
      const stream = filesystem.channel.createWriteStream(remotePath, originalMode !== undefined ? { mode: originalMode } : {});
      stream.once('error', reject);
      stream.once('close', resolve);
      stream.end(data);
    });

    try {
      const stats = await filesystem.lstat(remotePath);
      return SftpChannelFileSystem.toFileEntry(remotePath, stats);
    } catch {
      return null;
    }
  }

  async mkdir(remotePath: string): Promise<FileEntry | null> {
    const filesystem = await this.ensureControl();
    await filesystem.mkdir(remotePath);
    try {
      return SftpChannelFileSystem.toFileEntry(remotePath, await filesystem.lstat(remotePath));
    } catch {
      return null;
    }
  }

  async unlink(remotePath: string): Promise<void> {
    const filesystem = await this.ensureControl();
    await filesystem.unlink(remotePath);
  }

  async rename(oldPath: string, newPath: string): Promise<FileEntry | null> {
    const filesystem = await this.ensureControl();
    await filesystem.rename(oldPath, newPath);
    try {
      const stats = await filesystem.lstat(newPath);
      return SftpChannelFileSystem.toFileEntry(newPath, stats);
    } catch {
      return null;
    }
  }

  async chmod(remotePath: string, mode: number): Promise<FileEntry | null> {
    const filesystem = await this.ensureControl();
    await filesystem.chmod(remotePath, mode);
    try {
      const stats = await filesystem.lstat(remotePath);
      return SftpChannelFileSystem.toFileEntry(remotePath, stats);
    } catch {
      return null;
    }
  }

  async realpath(remotePath: string): Promise<RealPathResult> {
    const filesystem = await this.ensureControl();
    const absolutePath = await filesystem.realpath(remotePath);
    const stats = await filesystem.stat(absolutePath);
    return {
      requestedPath: remotePath,
      absolutePath,
      targetType: stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'unknown',
    };
  }
}
