import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { SFTPWrapper, Stats } from 'ssh2';
import type {
  RemoteDirectoryEntry,
  RemoteFileMetadata,
  RemoteFileSystem,
  RemotePositionedReader,
  RemotePositionedWriteOptions,
  RemotePositionedWriter,
  RemoteReadRange,
  RemoteWriteOptions,
} from '../../../platform/filesystem/remote-filesystem';
import { isRemoteFileMissingError } from '../../../platform/filesystem/remote-filesystem';

const call = <T>(invoke: (callback: (error: Error | undefined | null, value: T) => void) => void): Promise<T> =>
  new Promise<T>((resolve, reject) => invoke((error, value) => error ? reject(error) : resolve(value)));

const callVoid = (invoke: (callback: (error?: Error | null) => void) => void): Promise<void> =>
  new Promise<void>((resolve, reject) => invoke((error) => error ? reject(error) : resolve()));

export class SshRemoteFileSystemAdapter implements RemoteFileSystem {
  private readonly directoryPromises = new Map<string, Promise<void>>();

  constructor(private readonly channelProvider: () => Promise<SFTPWrapper>) {}

  async metadata(remotePath: string, options?: { followSymbolicLinks?: boolean }): Promise<RemoteFileMetadata> {
    const channel = await this.channelProvider();
    const stats = options?.followSymbolicLinks
      ? await call<Stats>((callback) => channel.stat(remotePath, callback))
      : await call<Stats>((callback) => channel.lstat(remotePath, callback));
    return toMetadata(stats);
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      await this.metadata(remotePath);
      return true;
    } catch (error) {
      if (isRemoteFileMissingError(error)) return false;
      throw error;
    }
  }

  async resolvePath(remotePath: string): Promise<string> {
    const channel = await this.channelProvider();
    return call<string>((callback) => channel.realpath(remotePath, callback));
  }

  async readDirectory(remotePath: string): Promise<RemoteDirectoryEntry[]> {
    const channel = await this.channelProvider();
    const entries = await call<Array<{ filename: string; longname: string; attrs: Stats }>>(
      (callback) => channel.readdir(remotePath, callback),
    );
    return entries.map((entry) => ({
      name: entry.filename,
      longName: entry.longname,
      metadata: toMetadata(entry.attrs),
    }));
  }

  async openRead(remotePath: string, range?: RemoteReadRange): Promise<Readable> {
    const channel = await this.channelProvider();
    return range
      ? channel.createReadStream(remotePath, { start: range.start, end: range.end })
      : channel.createReadStream(remotePath);
  }

  async openWrite(remotePath: string, options: RemoteWriteOptions = {}): Promise<Writable> {
    const channel = await this.channelProvider();
    return channel.createWriteStream(remotePath, {
      flags: options.flags ?? 'w',
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
      ...(options.highWaterMark !== undefined ? { highWaterMark: options.highWaterMark } : {}),
    });
  }

  async openPositionedReader(remotePath: string): Promise<RemotePositionedReader> {
    const channel = await this.channelProvider();
    const handle = await call<Buffer>((callback) => channel.open(remotePath, 'r', callback));
    let closed = false;
    return {
      read: async (position, length) => {
        if (closed) throw new Error(`Remote reader is closed: ${remotePath}`);
        if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) {
          throw new Error('Remote positioned read requires non-negative integer position and length.');
        }
        if (length === 0) return new Uint8Array();
        const buffer = Buffer.allocUnsafe(length);
        const bytesRead = await new Promise<number>((resolve, reject) => {
          channel.read(handle, buffer, 0, length, position, (error, count) => error ? reject(error) : resolve(count));
        });
        return buffer.subarray(0, bytesRead);
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await callVoid((callback) => channel.close(handle, callback));
      },
    };
  }

  async openPositionedWriter(
    remotePath: string,
    options: RemotePositionedWriteOptions = {},
  ): Promise<RemotePositionedWriter> {
    const channel = await this.channelProvider();
    const handle = await call<Buffer>((callback) =>
      options.mode === undefined
        ? channel.open(remotePath, 'w', callback)
        : channel.open(remotePath, 'w', options.mode, callback));
    let closed = false;
    return {
      write: async (position, data) => {
        if (closed) throw new Error(`Remote writer is closed: ${remotePath}`);
        if (!Number.isSafeInteger(position) || position < 0) {
          throw new Error('Remote positioned write requires a non-negative integer position.');
        }
        const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        if (buffer.length === 0) return;
        await callVoid((callback) => channel.write(handle, buffer, 0, buffer.length, position, callback));
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await callVoid((callback) => channel.close(handle, callback));
      },
    };
  }

  async createDirectory(remotePath: string): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid((callback) => channel.mkdir(remotePath, callback));
  }

  async ensureDirectory(remotePath: string): Promise<void> {
    const normalized = path.posix.normalize(remotePath).replace(/\/$/, '');
    if (!normalized || normalized === '/' || normalized === '.') return;
    if (!path.posix.isAbsolute(normalized)) throw new Error(`Remote directory must be absolute: ${remotePath}`);

    const existing = this.directoryPromises.get(normalized);
    if (existing) return existing;
    const pending = this.ensureDirectoryInternal(normalized).finally(() => this.directoryPromises.delete(normalized));
    this.directoryPromises.set(normalized, pending);
    await pending;
  }

  async removeFile(remotePath: string, options?: { ignoreMissing?: boolean }): Promise<void> {
    const channel = await this.channelProvider();
    try {
      await callVoid((callback) => channel.unlink(remotePath, callback));
    } catch (error) {
      if (options?.ignoreMissing && isRemoteFileMissingError(error)) return;
      throw error;
    }
  }

  async removeDirectory(remotePath: string): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid((callback) => channel.rmdir(remotePath, callback));
  }

  async rename(sourcePath: string, destinationPath: string): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid((callback) => channel.rename(sourcePath, destinationPath, callback));
  }

  async replaceFile(sourcePath: string, destinationPath: string): Promise<void> {
    const channel = await this.channelProvider();
    try {
      await callVoid((callback) => channel.ext_openssh_rename(sourcePath, destinationPath, callback));
      return;
    } catch (atomicRenameError) {
      if (!(await this.exists(destinationPath))) {
        await this.rename(sourcePath, destinationPath);
        return;
      }

      const backupPath = `${sourcePath}.previous`;
      await this.removeFile(backupPath, { ignoreMissing: true });
      await this.rename(destinationPath, backupPath);
      try {
        await this.rename(sourcePath, destinationPath);
        await this.removeFile(backupPath, { ignoreMissing: true });
      } catch (fallbackError) {
        try { await this.rename(backupPath, destinationPath); } catch { /* preserve primary failure */ }
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        const atomicMessage = atomicRenameError instanceof Error ? atomicRenameError.message : String(atomicRenameError);
        throw new Error(`Unable to replace ${destinationPath}: ${fallbackMessage} (atomic rename: ${atomicMessage})`);
      }
    }
  }

  async chmod(remotePath: string, mode: number): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid((callback) => channel.chmod(remotePath, mode, callback));
  }

  private async ensureDirectoryInternal(remotePath: string): Promise<void> {
    try {
      const metadata = await this.metadata(remotePath);
      if (!metadata.isDirectory) throw new Error(`Remote path exists but is not a directory: ${remotePath}`);
      return;
    } catch (error) {
      if (!isRemoteFileMissingError(error)) throw error;
    }

    const parent = path.posix.dirname(remotePath);
    if (parent !== remotePath && parent !== '/' && parent !== '.') await this.ensureDirectory(parent);
    try {
      await this.createDirectory(remotePath);
    } catch (error) {
      const finalState = await this.metadata(remotePath).catch(() => null);
      if (finalState?.isDirectory) return;
      throw error;
    }
  }
}

const toMetadata = (stats: Stats): RemoteFileMetadata => ({
  size: stats.size,
  uid: stats.uid,
  gid: stats.gid,
  mode: stats.mode,
  accessedAt: stats.atime * 1000,
  modifiedAt: stats.mtime * 1000,
  isDirectory: stats.isDirectory(),
  isFile: stats.isFile(),
  isSymbolicLink: stats.isSymbolicLink(),
});
