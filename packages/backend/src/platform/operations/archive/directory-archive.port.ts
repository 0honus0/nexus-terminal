import type { Readable } from 'node:stream';
import type { RemoteFileSystem } from '../../filesystem/remote-filesystem';

export interface DirectoryArchiveHandle {
  readonly stream: Readable;
  start(): Promise<void>;
  cancel(): void;
}

export interface DirectoryArchivePort {
  createZip(filesystem: RemoteFileSystem, remotePath: string): DirectoryArchiveHandle;
}
