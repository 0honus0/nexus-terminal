import path from 'node:path';
import type { Readable } from 'node:stream';
import { ZipArchive, type Archiver } from 'archiver';
import type { DirectoryArchiveHandle, DirectoryArchivePort } from '../../platform/operations/archive/directory-archive.port';
import type { RemoteFileSystem } from '../../platform/filesystem/remote-filesystem';

export class ZipDirectoryArchiveAdapter implements DirectoryArchivePort {
  createZip(filesystem: RemoteFileSystem, remotePath: string): DirectoryArchiveHandle {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const activeStreams = new Set<Readable>();
    let started = false;
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      for (const stream of activeStreams) stream.destroy();
      activeStreams.clear();
      archive.abort();
    };
    const start = async () => {
      if (started) throw new Error('Directory archive has already started.');
      started = true;
      await this.addDirectory(filesystem, archive, remotePath, '', new Set(), activeStreams, () => cancelled);
      if (!cancelled) await archive.finalize();
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
        await this.addDirectory(filesystem, archive, sourcePath, destinationPath, nextAncestors, activeStreams, isCancelled);
      } else if (metadata.isFile) {
        const stream = await filesystem.openRead(sourcePath);
        activeStreams.add(stream);
        const forget = () => activeStreams.delete(stream);
        stream.once('end', forget);
        stream.once('close', forget);
        stream.once('error', error => archive.emit('error', error));
        archive.append(stream, { name: destinationPath });
      }
    }
  }
}
