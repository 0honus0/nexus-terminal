import type { WorkspaceRemoteFileEntryDto } from '@nexus-terminal/protocol/workspace';
export type { WorkspaceRemoteFileEntryDto };

export type {
  WorkspaceFileSearchEntryDto,
  WorkspaceFilesystemListResponseDto,
  WorkspaceFilesystemSearchResponseDto,
  WorkspaceRemoteFileMetadataDto,
} from '@nexus-terminal/protocol/workspace';

export interface ResolvedRemotePath {
  requestedPath: string;
  path: string;
  targetType: 'file' | 'directory' | 'other';
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
  entries: WorkspaceRemoteFileEntryDto[];
  format: ArchiveCompressionFormat;
  passwordProtected?: boolean;
}
