import path from 'node:path';
import type { Readable } from 'node:stream';
import { ZipArchive, type Archiver } from 'archiver';
import type { RemoteFileSystem } from './remote-filesystem';

export interface DirectoryArchiveHandle {
  archive: Archiver;
  start(): Promise<void>;
  cancel(): void;
}

/** Builds streamed ZIP downloads using only the transport-neutral filesystem boundary. */
export class DirectoryArchiveService {
  createZip(filesystem: RemoteFileSystem, remotePath: string): DirectoryArchiveHandle {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const activeStreams = new Set<Readable>();
    let started = false;
    let aborted = false;

    const cancel = () => {
      if (aborted) return;
      aborted = true;
      for (const stream of activeStreams) stream.destroy();
      activeStreams.clear();
      archive.abort();
    };

    const start = async () => {
      if (started) throw new Error('Directory archive stream has already started.');
      started = true;
      await this.addDirectory(filesystem, archive, remotePath, '', new Set(), activeStreams, () => aborted);
      if (!aborted) await archive.finalize();
    };

    return { archive, start, cancel };
  }

  private async addDirectory(
    filesystem: RemoteFileSystem,
    archive: Archiver,
    remotePath: string,
    archivePath: string,
    ancestorRealPaths: ReadonlySet<string>,
    activeStreams: Set<Readable>,
    isAborted: () => boolean,
  ): Promise<void> {
    if (isAborted()) return;
    const realPath = await filesystem.resolvePath(remotePath);
    if (isAborted()) return;
    if (ancestorRealPaths.has(realPath)) {
      console.warn(`Remote archive: skipping symbolic-link cycle ${remotePath} -> ${realPath}`);
      return;
    }

    const nextAncestors = new Set(ancestorRealPaths);
    nextAncestors.add(realPath);
    const entries = await filesystem.readDirectory(remotePath);
    if (isAborted()) return;

    for (const entry of entries) {
      if (isAborted()) return;
      const currentRemotePath = path.posix.join(remotePath, entry.name);
      const currentArchivePath = path.posix.join(archivePath, entry.name);
      const metadata = entry.metadata.isSymbolicLink
        ? await filesystem.metadata(currentRemotePath, { followSymbolicLinks: true })
        : entry.metadata;

      if (metadata.isDirectory) {
        archive.append(Buffer.alloc(0), { name: `${currentArchivePath}/` });
        await this.addDirectory(
          filesystem,
          archive,
          currentRemotePath,
          currentArchivePath,
          nextAncestors,
          activeStreams,
          isAborted,
        );
      } else if (metadata.isFile) {
        const fileStream = await filesystem.openRead(currentRemotePath);
        activeStreams.add(fileStream);
        const forget = () => activeStreams.delete(fileStream);
        fileStream.once('end', forget);
        fileStream.once('close', forget);
        fileStream.on('error', (error) => {
          forget();
          archive.emit('error', error);
        });
        archive.append(fileStream, { name: currentArchivePath });
      }
    }
  }
}

export const directoryArchiveService = new DirectoryArchiveService();
