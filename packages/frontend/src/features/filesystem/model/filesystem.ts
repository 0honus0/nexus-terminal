import type { WorkspaceRemoteFileEntryDto } from '@nexus-terminal/protocol/workspace';

export type RemoteFileEntry = WorkspaceRemoteFileEntryDto;
export type {
  WorkspaceFileSearchEntryDto as FileSearchEntry,
  WorkspaceFilesystemListResponseDto as DirectoryListing,
  WorkspaceFilesystemSearchResponseDto as FileSearchResult,
  WorkspaceRemoteFileMetadataDto as RemoteFileMetadata,
} from '@nexus-terminal/protocol/workspace';

export interface ResolvedRemotePath {
  requestedPath: string;
  path: string;
  targetType: 'file' | 'directory' | 'other';
}

export interface RemoteTextFile {
  path: string;
  content: string;
  encoding: string;
  rawContent: Uint8Array;
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
