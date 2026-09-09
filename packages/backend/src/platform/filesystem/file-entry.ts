import path from 'node:path';
import type { RemoteFileMetadata } from './remote-filesystem';

export interface RemoteFileEntry {
  name: string;
  path: string;
  longName?: string;
  metadata: RemoteFileMetadata;
}

export interface RemoteFileSearchEntry extends RemoteFileEntry {
  relativePath: string;
}

export interface RemoteFileSearchResult {
  items: RemoteFileSearchEntry[];
  truncated: boolean;
}

export const toRemoteFileEntry = (
  remotePath: string,
  metadata: RemoteFileMetadata,
  longName?: string,
): RemoteFileEntry => ({
  name: path.posix.basename(remotePath),
  path: remotePath,
  ...(longName ? { longName } : {}),
  metadata,
});
