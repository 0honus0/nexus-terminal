import path from 'node:path';
import { Readable } from 'node:stream';
import { ZipArchive, type Archiver } from 'archiver';
import type {
  DirectoryArchiveHandle,
  DirectoryArchivePort,
} from '../../platform/operations/archive/directory-archive.port';
import type { RemoteFileSystem } from '../../platform/filesystem/remote-filesystem';
import { runtimePerformanceMetrics } from '../../shared/observability/runtime-performance';

const ARCHIVE_READ_CHUNK_BYTES = 32 * 1024;
const ARCHIVE_READ_CONCURRENCY = 32;

class ArchiveFileReadGate {
  private active = false;
  private readonly waiters: Array<(release: (() => void) | null) => void> = [];

  acquire(): Promise<(() => void) | null> {
    if (!this.active) {
      this.active = true;
      return Promise.resolve(this.createRelease());
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  cancelWaiting(): void {
    for (const resolve of this.waiters.splice(0)) resolve(null);
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next(this.createRelease());
      else this.active = false;
    };
  }
}

export class ZipDirectoryArchiveAdapter implements DirectoryArchivePort {
  createZip(filesystem: RemoteFileSystem, remotePath: string): DirectoryArchiveHandle {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const activeStreams = new Set<Readable>();
    const fileReadGate = new ArchiveFileReadGate();
    let started = false;
    let cancelled = false;
    let signalCancelled!: () => void;
    const cancelledSignal = new Promise<void>((resolve) => {
      signalCancelled = resolve;
    });
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      signalCancelled();
      fileReadGate.cancelWaiting();
      for (const stream of activeStreams) stream.destroy();
      activeStreams.clear();
      archive.abort();
    };
    const start = async () => {
      if (started) throw new Error('Directory archive has already started.');
      started = true;
      const perfStartedAt = runtimePerformanceMetrics.archiveZipStarted();
      let completed = false;
      try {
        await this.addDirectory(
          filesystem,
          archive,
          remotePath,
          '',
          new Set(),
          activeStreams,
          fileReadGate,
          () => cancelled,
        );
        if (!cancelled) {
          const finalize = archive.finalize();
          await Promise.race([finalize, cancelledSignal]);
          if (!cancelled) {
            await finalize;
            completed = true;
          }
        }
      } finally {
        runtimePerformanceMetrics.archiveZipFinished(perfStartedAt, completed, cancelled, archive.pointer());
      }
    };
    return { stream: archive, start, cancel };
  }

  private async addDirectory(
    filesystem: RemoteFileSystem,
    archive: Archiver,
    remotePath: string,
    archivePath: string,
    ancestors: ReadonlySet<string>,
    activeStreams: Set<Readable>,
    fileReadGate: ArchiveFileReadGate,
    isCancelled: () => boolean,
  ): Promise<void> {
    if (isCancelled()) return;
    const realPath = await filesystem.resolvePath(remotePath);
    if (ancestors.has(realPath)) return;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(realPath);
    for (const entry of await filesystem.readDirectory(remotePath)) {
      if (isCancelled()) return;
      if (entry.name === '.' || entry.name === '..') continue;
      const sourcePath = path.posix.join(remotePath, entry.name);
      const destinationPath = path.posix.join(archivePath, entry.name);
      const metadata = entry.metadata.isSymbolicLink
        ? await filesystem.metadata(sourcePath, { followSymbolicLinks: true })
        : entry.metadata;
      if (metadata.isDirectory) {
        archive.append(Buffer.alloc(0), { name: `${destinationPath}/` });
        await this.addDirectory(
          filesystem,
          archive,
          sourcePath,
          destinationPath,
          nextAncestors,
          activeStreams,
          fileReadGate,
          isCancelled,
        );
      } else if (metadata.isFile) {
        const stream = this.createPositionedReadStream(
          filesystem,
          sourcePath,
          metadata.size,
          fileReadGate,
          isCancelled,
        );
        activeStreams.add(stream);
        const forget = () => activeStreams.delete(stream);
        stream.once('end', forget);
        stream.once('close', forget);
        stream.once('error', (error) => archive.emit('error', error));
        archive.append(stream, { name: destinationPath });
      }
    }
  }

  private createPositionedReadStream(
    filesystem: RemoteFileSystem,
    sourcePath: string,
    fileSize: number,
    fileReadGate: ArchiveFileReadGate,
    isCancelled: () => boolean,
  ): Readable {
    const size = Math.max(0, fileSize);
    const chunks = async function* () {
      if (size === 0) return;
      const releaseFileRead = await fileReadGate.acquire();
      if (!releaseFileRead) return;
      try {
        if (isCancelled()) return;
        const reader = await filesystem.openPositionedReader(sourcePath);
        try {
          for (let batchStart = 0; batchStart < size;) {
            if (isCancelled()) return;
            const batch: Array<Promise<Buffer>> = [];
            for (let index = 0; index < ARCHIVE_READ_CONCURRENCY && batchStart < size; index += 1) {
              const position = batchStart;
              const length = Math.min(ARCHIVE_READ_CHUNK_BYTES, size - position);
              batchStart += length;
              batch.push(
                (async () => {
                  const buffer = Buffer.allocUnsafe(length);
                  runtimePerformanceMetrics.recordSftpPositionedReadAllocation(length);
                  let offset = 0;
                  while (offset < length) {
                    if (isCancelled()) return buffer.subarray(0, offset);
                    const bytesRead = await reader.readInto(position + offset, buffer.subarray(offset));
                    if (bytesRead === 0) throw new Error(`Unexpected end of file while archiving ${sourcePath}.`);
                    offset += bytesRead;
                  }
                  return buffer;
                })(),
              );
            }
            for (const chunk of await Promise.all(batch)) {
              if (isCancelled()) return;
              if (chunk.byteLength) yield chunk;
            }
          }
        } finally {
          await reader.close().catch(() => undefined);
        }
      } finally {
        releaseFileRead();
      }
    };
    return Readable.from(chunks());
  }
}
