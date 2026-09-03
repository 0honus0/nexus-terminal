import type { Readable } from 'node:stream';

export interface RemoteFileMetadata {
  size: number;
  mode: number;
  modifiedAt: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface RemoteDirectoryEntry {
  name: string;
  metadata: RemoteFileMetadata;
}

export interface RemoteReadRange {
  start: number;
  end?: number;
}

export interface RemoteFileSystem {
  metadata(path: string, options?: { followSymbolicLinks?: boolean }): Promise<RemoteFileMetadata>;
  resolvePath(path: string): Promise<string>;
  readDirectory(path: string): Promise<RemoteDirectoryEntry[]>;
  openRead(path: string, range?: RemoteReadRange): Promise<Readable>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  createDirectory(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

export type RemoteFileSystemRole = 'control' | 'transfer' | 'background';

export interface RemoteFileSystemProvider {
  get(sessionId: string, role: RemoteFileSystemRole): Promise<RemoteFileSystem>;
  closeSession(sessionId: string): Promise<void>;
}
