import type { Readable } from 'node:stream';
import type { FileAttributes } from './types';

export interface RemoteFileMetadata extends FileAttributes {}

export interface RemoteDirectoryEntry {
  name: string;
  longname: string;
  metadata: RemoteFileMetadata;
}

export interface RemoteReadRange {
  start: number;
  end: number;
}

/**
 * Transport-neutral read-side filesystem boundary shared by HTTP, Workspace,
 * background operations and future Agent tools.
 */
export interface RemoteFileSystem {
  metadata(remotePath: string, options?: { followSymbolicLinks?: boolean }): Promise<RemoteFileMetadata>;
  resolvePath(remotePath: string): Promise<string>;
  readDirectory(remotePath: string): Promise<RemoteDirectoryEntry[]>;
  openRead(remotePath: string, range?: RemoteReadRange): Promise<Readable>;
}

export const isRemoteFileMissingError = (error: unknown): boolean => {
  if (!error) return false;
  const value = error as { code?: unknown; message?: unknown };
  if (value.code === 2 || value.code === 'ENOENT') return true;
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  return message.includes('no such file') || message.includes('not found');
};
