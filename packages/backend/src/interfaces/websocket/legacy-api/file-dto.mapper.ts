import type {
  RemoteFileEntry,
  RemoteFileSearchEntry,
  RemoteFileSearchResult,
} from '../../../platform/filesystem/file-entry';
import type { RemoteFileMetadata } from '../../../platform/filesystem/remote-filesystem';

export interface LegacyFileAttributes {
  size: number;
  uid: number;
  gid: number;
  mode: number;
  atime: number;
  mtime: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface LegacyFileListItem {
  filename: string;
  longname: string;
  attrs: LegacyFileAttributes;
  path?: string;
  basename?: string;
  relativePath?: string;
}

export const toLegacyFileAttributes = (metadata: RemoteFileMetadata): LegacyFileAttributes => ({
  size: metadata.size,
  uid: metadata.uid,
  gid: metadata.gid,
  mode: metadata.mode,
  atime: metadata.accessedAt,
  mtime: metadata.modifiedAt,
  isDirectory: metadata.isDirectory,
  isFile: metadata.isFile,
  isSymbolicLink: metadata.isSymbolicLink,
});

export const toLegacyFileItem = (entry: RemoteFileEntry): LegacyFileListItem => ({
  filename: entry.name,
  longname: entry.longName ?? entry.name,
  attrs: toLegacyFileAttributes(entry.metadata),
  path: entry.path,
});

export const toLegacySearchItem = (entry: RemoteFileSearchEntry): LegacyFileListItem => ({
  filename: entry.relativePath,
  basename: entry.name,
  relativePath: entry.relativePath,
  path: entry.path,
  longname: entry.longName ?? entry.name,
  attrs: toLegacyFileAttributes(entry.metadata),
});

export const toLegacySearchResult = (result: RemoteFileSearchResult) => ({
  items: result.items.map(toLegacySearchItem),
  truncated: result.truncated,
});
