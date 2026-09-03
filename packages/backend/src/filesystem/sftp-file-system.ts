import path from 'node:path';
import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { ExecutionSession } from '../execution/execution-session';
import type { FileAttributes, FileEntry, FileSearchResult, ReadFileResult, RealPathResult } from './types';

const SEARCH_CONCURRENCY = 8;
const SEARCH_MAX_RESULTS = 500;
const SEARCH_MAX_DIRECTORIES = 5000;
const SEARCH_MAX_QUERY_LENGTH = 256;

function attrs(stats: Stats): FileAttributes {
  return {
    size: stats.size,
    uid: stats.uid,
    gid: stats.gid,
    mode: stats.mode,
    atime: stats.atime * 1000,
    mtime: stats.mtime * 1000,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    isSymbolicLink: stats.isSymbolicLink(),
  };
}

function entry(filename: string, longname: string, stats: Stats): FileEntry {
  return { filename, longname, attrs: attrs(stats) };
}

function call<T>(invoke: (callback: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    invoke((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function callVoid(invoke: (callback: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    invoke((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Reusable remote filesystem facade backed by one ExecutionSession.
 * It contains no WebSocket or UI state and is shared by Workspace and Agent callers.
 */
export class SftpFileSystem {
  constructor(private readonly session: ExecutionSession) {}

  async ensureControl(): Promise<SFTPWrapper> {
    if (!this.session.isReady) throw new Error('SSH 会话未就绪');
    return this.session.sftp.ensure('control');
  }

  async list(remotePath: string): Promise<FileEntry[]> {
    const sftp = await this.ensureControl();
    const list = await call<Array<{ filename: string; longname: string; attrs: Stats }>>((cb) => sftp.readdir(remotePath, cb));
    return list.map((item) => entry(item.filename, item.longname, item.attrs));
  }

  async search(rootPath: string, query: string): Promise<FileSearchResult> {
    if (!this.session.isReady) throw new Error('SSH 会话未就绪');
    const normalizedQuery = query.trim().slice(0, SEARCH_MAX_QUERY_LENGTH).toLocaleLowerCase();
    const normalizedRoot = path.posix.resolve('/', rootPath || '/');
    if (!normalizedQuery) return { items: [], truncated: false };

    const sftp = await this.session.sftp.ensure('background');
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
          const list = await call<Array<{ filename: string; longname: string; attrs: Stats }>>((cb) => sftp.readdir(directory, cb));
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
              ...entry(relativePath, item.longname, item.attrs),
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
    const sftp = await this.ensureControl();
    const stats = await call<Stats>((cb) => sftp.lstat(remotePath, cb));
    return attrs(stats);
  }

  async readFile(remotePath: string, requestedEncoding?: string): Promise<ReadFileResult> {
    const sftp = await this.ensureControl();
    const fileData = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(remotePath);
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
    const sftp = await this.ensureControl();
    const data = iconv.encode(content, encoding);
    let originalMode: number | undefined;
    try {
      originalMode = (await call<Stats>((cb) => sftp.lstat(remotePath, cb))).mode;
    } catch {
      // New file: no existing permissions to preserve.
    }

    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath, originalMode !== undefined ? { mode: originalMode } : {});
      stream.once('error', reject);
      stream.once('close', resolve);
      stream.end(data);
    });

    try {
      const stats = await call<Stats>((cb) => sftp.lstat(remotePath, cb));
      return entry(path.posix.basename(remotePath), '', stats);
    } catch {
      return null;
    }
  }

  async mkdir(remotePath: string): Promise<FileEntry | null> {
    const sftp = await this.ensureControl();
    await callVoid((cb) => sftp.mkdir(remotePath, cb));
    try {
      const stats = await call<Stats>((cb) => sftp.lstat(remotePath, cb));
      return entry(path.posix.basename(remotePath), '', stats);
    } catch {
      return null;
    }
  }

  async unlink(remotePath: string): Promise<void> {
    const sftp = await this.ensureControl();
    await callVoid((cb) => sftp.unlink(remotePath, cb));
  }

  async rename(oldPath: string, newPath: string): Promise<FileEntry | null> {
    const sftp = await this.ensureControl();
    await callVoid((cb) => sftp.rename(oldPath, newPath, cb));
    try {
      const stats = await call<Stats>((cb) => sftp.lstat(newPath, cb));
      return entry(path.posix.basename(newPath), '', stats);
    } catch {
      return null;
    }
  }

  async chmod(remotePath: string, mode: number): Promise<FileEntry | null> {
    const sftp = await this.ensureControl();
    await callVoid((cb) => sftp.chmod(remotePath, mode, cb));
    try {
      const stats = await call<Stats>((cb) => sftp.lstat(remotePath, cb));
      return entry(path.posix.basename(remotePath), '', stats);
    } catch {
      return null;
    }
  }

  async realpath(remotePath: string): Promise<RealPathResult> {
    const sftp = await this.ensureControl();
    const absolutePath = await call<string>((cb) => sftp.realpath(remotePath, cb));
    const stats = await call<Stats>((cb) => sftp.stat(absolutePath, cb));
    return {
      requestedPath: remotePath,
      absolutePath,
      targetType: stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'unknown',
    };
  }
}
