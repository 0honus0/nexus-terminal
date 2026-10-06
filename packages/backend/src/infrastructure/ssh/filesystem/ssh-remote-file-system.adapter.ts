import path from 'node:path';
import { Readable, type Writable } from 'node:stream';
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
import { isRemoteFileMissingError, RemoteDirectoryTypeConflict } from '../../../platform/filesystem/remote-filesystem';
import { runtimePerformanceMetrics } from '../../../shared/observability/runtime-performance';

const channelSignals = new WeakMap<SFTPWrapper, AbortSignal>();
export const bindSftpChannelCancellation = (channel: SFTPWrapper, signal: AbortSignal): void => {
  channelSignals.set(channel, signal);
};

const call = <T>(
  channel: SFTPWrapper,
  invoke: (callback: (error: Error | undefined | null, value: T) => void) => void,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const signal = channelSignals.get(channel);
    const detach = () => {
      channel.off('end', onClose);
      channel.off('close', onClose);
      signal?.removeEventListener('abort', onClose);
    };
    const onClose = () => {
      detach();
      reject(new Error('SFTP_CHANNEL_CLOSED'));
    };
    channel.once('end', onClose);
    channel.once('close', onClose);
    signal?.addEventListener('abort', onClose, { once: true });
    if (signal?.aborted) {
      onClose();
      return;
    }
    try {
      invoke((error, value) => {
        detach();
        error ? reject(error) : resolve(value);
      });
    } catch (error) {
      detach();
      reject(error);
    }
  });

const callVoid = (channel: SFTPWrapper, invoke: (callback: (error?: Error | null) => void) => void): Promise<void> =>
  call<void>(channel, (callback) => invoke((error) => callback(error, undefined)));

export class SshRemoteFileSystemAdapter implements RemoteFileSystem {
  private readonly directoryPromises = new Map<string, Promise<void>>();

  constructor(private readonly channelProvider: () => Promise<SFTPWrapper>) {}

  async metadata(remotePath: string, options?: { followSymbolicLinks?: boolean }): Promise<RemoteFileMetadata> {
    const channel = await this.channelProvider();
    const stats = options?.followSymbolicLinks
      ? await call<Stats>(channel, (callback) => channel.stat(remotePath, callback))
      : await call<Stats>(channel, (callback) => channel.lstat(remotePath, callback));
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
    return call<string>(channel, (callback) => channel.realpath(remotePath, callback));
  }

  async readDirectory(remotePath: string): Promise<RemoteDirectoryEntry[]> {
    const channel = await this.channelProvider();
    const entries = await call<Array<{ filename: string; longname: string; attrs: Stats }>>(channel, (callback) =>
      channel.readdir(remotePath, callback),
    );
    return entries.map((entry) => ({
      name: entry.filename,
      longName: entry.longname,
      metadata: toMetadata(entry.attrs),
    }));
  }

  async openRead(remotePath: string, range?: RemoteReadRange): Promise<Readable> {
    const metadata = await this.metadata(remotePath, { followSymbolicLinks: true });
    const reader = await this.openPositionedReader(remotePath);
    const start = range?.start ?? 0;
    const end = Math.min(metadata.size, range?.end === undefined ? metadata.size : range.end + 1);
    // Bounded, ordered prefetch hides SFTP round-trip latency without buffering
    // the whole file. Short reads are completed before yielding each range.
    // ssh2 can split larger reads into serial protocol requests. Keep blocks
    // below common packet limits while preserving the 1MiB prefetch budget.
    const chunkBytes = 16 * 1024;
    const concurrency = 64;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await reader.close();
    };
    const readChunk = async (position: number, length: number): Promise<Buffer> => {
      const buffer = Buffer.allocUnsafe(length);
      let offset = 0;
      while (offset < length) {
        const count = await reader.readInto(position + offset, buffer.subarray(offset));
        if (count === 0) throw new Error(`Unexpected end of remote file: ${remotePath}`);
        offset += count;
      }
      return buffer;
    };
    const stream = Readable.from(
      (async function* () {
        const pending: Array<Promise<Buffer>> = [];
        let position = start;
        const enqueue = () => {
          if (position >= end) return;
          const length = Math.min(chunkBytes, end - position);
          const task = readChunk(position, length);
          // Later requests may fail before the ordered consumer reaches them.
          void task.catch(() => undefined);
          pending.push(task);
          position += length;
        };
        try {
          for (let i = 0; i < concurrency; i++) enqueue();
          while (pending.length) {
            const data = await pending.shift()!;
            enqueue();
            yield data;
          }
        } finally {
          await Promise.allSettled(pending);
          await close();
        }
      })(),
      { objectMode: false, highWaterMark: chunkBytes },
    );
    // Also close an opened handle when a consumer destroys before its first read.
    stream.once('close', () => {
      void close().catch(() => undefined);
    });
    return stream;
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
    const handle = await call<Buffer>(channel, (callback) => channel.open(remotePath, 'r', callback));
    let closed = false;
    let channelClosed = false;
    const onChannelClose = () => {
      channelClosed = true;
    };
    channel.once('end', onChannelClose);
    channel.once('close', onChannelClose);
    const readInto = async (position: number, target: Uint8Array): Promise<number> => {
      if (closed) throw new Error(`Remote reader is closed: ${remotePath}`);
      if (!Number.isSafeInteger(position) || position < 0) {
        throw new Error('Remote positioned read requires a non-negative integer position.');
      }
      if (target.byteLength === 0) return 0;
      const buffer = Buffer.from(target.buffer, target.byteOffset, target.byteLength);
      const startedAt = runtimePerformanceMetrics.sftpPositionedReadStarted(buffer.length);
      let bytesRead = 0;
      try {
        bytesRead = await call<number>(channel, (callback) => {
          channel.read(handle, buffer, 0, buffer.length, position, (error, count) => callback(error, count));
        });
        return bytesRead;
      } finally {
        runtimePerformanceMetrics.sftpPositionedReadFinished(startedAt, bytesRead);
      }
    };
    return {
      read: async (position, length) => {
        if (closed) throw new Error(`Remote reader is closed: ${remotePath}`);
        if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) {
          throw new Error('Remote positioned read requires non-negative integer position and length.');
        }
        if (length === 0) return new Uint8Array();
        const buffer = Buffer.allocUnsafe(length);
        runtimePerformanceMetrics.recordSftpPositionedReadAllocation(length);
        const bytesRead = await readInto(position, buffer);
        return buffer.subarray(0, bytesRead);
      },
      readInto,
      close: async () => {
        if (closed) return;
        closed = true;
        channel.off('end', onChannelClose);
        channel.off('close', onChannelClose);
        if (channelClosed || channelSignals.get(channel)?.aborted) return;
        await callVoid(channel, (callback) => channel.close(handle, callback));
      },
    };
  }

  async openPositionedWriter(
    remotePath: string,
    options: RemotePositionedWriteOptions = {},
  ): Promise<RemotePositionedWriter> {
    const channel = await this.channelProvider();
    const handle = await call<Buffer>(channel, (callback) =>
      options.mode === undefined
        ? channel.open(remotePath, 'w', callback)
        : channel.open(remotePath, 'w', options.mode, callback),
    );
    let closed = false;
    return {
      write: async (position, data) => {
        if (closed) throw new Error(`Remote writer is closed: ${remotePath}`);
        if (!Number.isSafeInteger(position) || position < 0) {
          throw new Error('Remote positioned write requires a non-negative integer position.');
        }
        const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        if (buffer.length === 0) return;
        const startedAt = runtimePerformanceMetrics.sftpPositionedWriteStarted(buffer.length);
        try {
          await callVoid(channel, (callback) => channel.write(handle, buffer, 0, buffer.length, position, callback));
        } finally {
          runtimePerformanceMetrics.sftpPositionedWriteFinished(startedAt);
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await callVoid(channel, (callback) => channel.close(handle, callback));
      },
    };
  }

  async createDirectory(remotePath: string): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid(channel, (callback) => channel.mkdir(remotePath, callback));
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
      await callVoid(channel, (callback) => channel.unlink(remotePath, callback));
    } catch (error) {
      if (options?.ignoreMissing && isRemoteFileMissingError(error)) return;
      throw error;
    }
  }

  async removeDirectory(remotePath: string): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid(channel, (callback) => channel.rmdir(remotePath, callback));
  }

  async rename(sourcePath: string, destinationPath: string): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid(channel, (callback) => channel.rename(sourcePath, destinationPath, callback));
  }

  async replaceFile(sourcePath: string, destinationPath: string): Promise<void> {
    const channel = await this.channelProvider();
    try {
      await callVoid(channel, (callback) => channel.ext_openssh_rename(sourcePath, destinationPath, callback));
      return;
    } catch (atomicRenameError) {
      let destinationMetadata: RemoteFileMetadata | null = null;
      try {
        destinationMetadata = await this.metadata(destinationPath);
      } catch (error) {
        if (!isRemoteFileMissingError(error)) throw error;
      }
      if (!destinationMetadata) {
        await this.rename(sourcePath, destinationPath);
        return;
      }
      if (destinationMetadata.isDirectory) {
        throw new Error(`Refusing to replace remote directory with a file: ${destinationPath}`);
      }

      const backupPath = `${sourcePath}.previous`;
      await this.removeFile(backupPath, { ignoreMissing: true });
      await this.rename(destinationPath, backupPath);
      try {
        await this.rename(sourcePath, destinationPath);
        await this.removeFile(backupPath, { ignoreMissing: true });
      } catch (fallbackError) {
        try {
          await this.rename(backupPath, destinationPath);
        } catch {
          /* preserve primary failure */
        }
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        const atomicMessage =
          atomicRenameError instanceof Error ? atomicRenameError.message : String(atomicRenameError);
        throw new Error(`Unable to replace ${destinationPath}: ${fallbackMessage} (atomic rename: ${atomicMessage})`);
      }
    }
  }

  async chmod(remotePath: string, mode: number): Promise<void> {
    const channel = await this.channelProvider();
    await callVoid(channel, (callback) => channel.chmod(remotePath, mode, callback));
  }

  private async ensureDirectoryInternal(remotePath: string): Promise<void> {
    try {
      const metadata = await this.metadata(remotePath);
      if (!metadata.isDirectory) throw new RemoteDirectoryTypeConflict(remotePath);
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
