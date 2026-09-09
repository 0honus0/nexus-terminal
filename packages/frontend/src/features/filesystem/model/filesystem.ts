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
export interface RemoteFileEntry {
  name: string;
  path: string;
  longName?: string;
  metadata: RemoteFileMetadata;
}
export interface FileSearchEntry extends RemoteFileEntry {
  relativePath: string;
}
export interface DirectoryListing {
  path: string;
  entries: RemoteFileEntry[];
}
export interface FileSearchResult {
  entries: FileSearchEntry[];
  truncated: boolean;
}

export interface ResolvedRemotePath {
  requestedPath: string;
  path: string;
  targetType: 'file' | 'directory' | 'other';
}

export interface RemoteTextFile {
  path: string;
  content: string;
  encoding: string;
  rawContentBase64: string;
}
export type FilesystemMutation =
  | { type: 'create-directory'; path: string }
  | { type: 'create-file'; path: string; content?: string }
  | { type: 'remove'; paths: string[] }
  | { type: 'rename'; from: string; to: string }
  | { type: 'chmod'; path: string; mode: number };

export interface LocalUploadFile {
  file: File;
  relativeDirectory?: string;
}

export interface LocalUploadBatch {
  files: LocalUploadFile[];
  directories: string[];
}

export type ArchiveCompressionFormat = 'zip' | 'tar.gz' | 'tar.bz2';

export interface ArchiveCompressionIntent {
  entries: RemoteFileEntry[];
  format: ArchiveCompressionFormat;
  passwordProtected?: boolean;
}
