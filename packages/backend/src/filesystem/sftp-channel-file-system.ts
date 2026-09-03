import path from 'node:path';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { FileEntry } from './types';

export interface SftpDirectoryEntry {
  filename: string;
  longname: string;
  attrs: Stats;
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
 * Filesystem primitives bound to one concrete SFTP channel.
 *
 * This is intentionally below Workspace/Agent concerns. Callers that already own a
 * channel (transfer/upload) reuse this adapter, while SftpFileSystem chooses channels
 * from an ExecutionSession for normal filesystem operations.
 */
export class SftpChannelFileSystem {
  private static readonly directoryEnsurePromises = new WeakMap<SFTPWrapper, Map<string, Promise<void>>>();

  constructor(public readonly channel: SFTPWrapper) {}

  static isMissing(error: unknown): boolean {
    if (!error) return false;
    const value = error as { code?: unknown; message?: unknown };
    if (value.code === 2 || value.code === 'ENOENT') return true;
    const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
    return message.includes('no such file') || message.includes('not found');
  }

  static toAttributes(stats: Stats): FileEntry['attrs'] {
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

  static toFileEntry(itemPath: string, stats: Stats, longname = ''): FileEntry {
    return {
      filename: path.posix.basename(itemPath),
      longname,
      attrs: SftpChannelFileSystem.toAttributes(stats),
    };
  }

  lstat(remotePath: string): Promise<Stats> {
    return call<Stats>((callback) => this.channel.lstat(remotePath, callback));
  }

  stat(remotePath: string): Promise<Stats> {
    return call<Stats>((callback) => this.channel.stat(remotePath, callback));
  }

  realpath(remotePath: string): Promise<string> {
    return call<string>((callback) => this.channel.realpath(remotePath, callback));
  }

  list(remotePath: string): Promise<SftpDirectoryEntry[]> {
    return call<SftpDirectoryEntry[]>((callback) => this.channel.readdir(remotePath, callback));
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return callVoid((callback) => this.channel.rename(oldPath, newPath, callback));
  }

  unlink(remotePath: string): Promise<void> {
    return callVoid((callback) => this.channel.unlink(remotePath, callback));
  }

  mkdir(remotePath: string): Promise<void> {
    return callVoid((callback) => this.channel.mkdir(remotePath, callback));
  }

  rmdir(remotePath: string): Promise<void> {
    return callVoid((callback) => this.channel.rmdir(remotePath, callback));
  }

  chmod(remotePath: string, mode: number): Promise<void> {
    return callVoid((callback) => this.channel.chmod(remotePath, mode, callback));
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      await this.lstat(remotePath);
      return true;
    } catch (error) {
      if (SftpChannelFileSystem.isMissing(error)) return false;
      throw error;
    }
  }

  async ensureDirectory(remotePath: string): Promise<void> {
    const normalizedPath = remotePath.replace(/\/$/, '');
    if (!normalizedPath || normalizedPath === '/') return;

    let pendingByPath = SftpChannelFileSystem.directoryEnsurePromises.get(this.channel);
    if (!pendingByPath) {
      pendingByPath = new Map<string, Promise<void>>();
      SftpChannelFileSystem.directoryEnsurePromises.set(this.channel, pendingByPath);
    }

    const existing = pendingByPath.get(normalizedPath);
    if (existing) return existing;

    const pending = this.ensureDirectoryInternal(normalizedPath).finally(() => pendingByPath?.delete(normalizedPath));
    pendingByPath.set(normalizedPath, pending);
    await pending;
  }

  private async ensureDirectoryInternal(normalizedPath: string): Promise<void> {
    try {
      const stats = await this.lstat(normalizedPath);
      if (!stats.isDirectory()) throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
      return;
    } catch (error) {
      if (!SftpChannelFileSystem.isMissing(error)) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`检查目录失败 ${normalizedPath}: ${message}`);
      }
    }

    const parent = path.posix.dirname(normalizedPath);
    if (parent && parent !== '/' && parent !== '.') await this.ensureDirectory(parent);

    try {
      await this.mkdir(normalizedPath);
    } catch (error) {
      // Concurrent branches can race on the same directory. Verify the final state.
      const finalStats = await this.lstat(normalizedPath).catch(() => null);
      if (finalStats?.isDirectory()) return;
      throw error;
    }
  }
}
