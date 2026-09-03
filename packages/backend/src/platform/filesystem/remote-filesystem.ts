import type { Readable, Writable } from 'node:stream';

export interface RemoteFileMetadata {
  size: number;
  uid: number;
  gid: number;
  mode: number;
  accessedAt: number;
  modifiedAt: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface RemoteDirectoryEntry {
  name: string;
  longName?: string;
  metadata: RemoteFileMetadata;
}

export interface RemoteReadRange {
  start: number;
  end?: number;
}

export interface RemoteWriteOptions {
  mode?: number;
  highWaterMark?: number;
  flags?: 'w' | 'a';
}

export interface RemotePositionedReader {
  read(position: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface RemotePositionedWriter {
  write(position: number, data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface RemotePositionedWriteOptions {
  mode?: number;
}

/** Technology-neutral remote filesystem port. */
export interface RemoteFileSystem {
  metadata(path: string, options?: { followSymbolicLinks?: boolean }): Promise<RemoteFileMetadata>;
  exists(path: string): Promise<boolean>;
  resolvePath(path: string): Promise<string>;
  readDirectory(path: string): Promise<RemoteDirectoryEntry[]>;
  openRead(path: string, range?: RemoteReadRange): Promise<Readable>;
  openWrite(path: string, options?: RemoteWriteOptions): Promise<Writable>;
  openPositionedReader(path: string): Promise<RemotePositionedReader>;
  openPositionedWriter(path: string, options?: RemotePositionedWriteOptions): Promise<RemotePositionedWriter>;
  createDirectory(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  removeFile(path: string, options?: { ignoreMissing?: boolean }): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  /** Replace destination with source, using the strongest atomic rename supported by the transport. */
  replaceFile(sourcePath: string, destinationPath: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

export type RemoteFileSystemRole = 'control' | 'transfer' | 'background';

export const isRemoteFileMissingError = (error: unknown): boolean => {
  if (!error) return false;
  const value = error as { code?: unknown; message?: unknown };
  if (value.code === 2 || value.code === 'ENOENT') return true;
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  return message.includes('no such file') || message.includes('not found');
};
