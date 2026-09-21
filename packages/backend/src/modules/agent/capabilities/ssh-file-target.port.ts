import type { ToolContext } from './tool.types';

export interface SshFileReadResult {
  path: string;
  resolvedPath: string;
  sizeBytes: number;
  modifiedAt: number;
  offset: number;
  bytesRead: number;
  truncated: boolean;
  content: string;
}

export interface SshFilePathInspection {
  path: string;
  resolvedPath: string;
  exists: boolean;
  type: 'file' | 'directory' | null;
  sizeBytes: number | null;
  modifiedAt: number | null;
  mode: number | null;
  sha256: string | null;
}

export interface SshFileMutationInspection extends SshFilePathInspection {
  type: 'file' | null;
}

export interface SshFileMutationResult extends SshFileMutationInspection {
  bytesWritten: number;
}

export interface SshFileListResult {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    sizeBytes: number;
    modifiedAt: number;
  }>;
  truncated: boolean;
}

export interface SshFileSearchResult {
  query: string;
  path: string;
  engine: 'sftp';
  matches: Array<{
    path: string;
    line: number;
    column: number;
    text: string;
    before: string[];
    after: string[];
  }>;
  truncated: boolean;
  scannedFiles: number;
  scannedBytes: number;
}

export interface SshFileMoveResult {
  path: string;
  destinationPath: string;
  type: 'file' | 'directory';
  sha256: string | null;
}

export interface SshFileDeleteResult {
  path: string;
  type: 'file' | 'directory';
  deleted: true;
}

export interface SshFileReplacement {
  path: string;
  content: Uint8Array;
  expectedSha256: string;
}

export interface SshFileReplacementResult {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface SshFileTargetPort {
  stat(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    expectedConfigurationHash: string,
  ): Promise<SshFilePathInspection>;
  read(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    maxBytes: number,
    offset: number,
    expectedConfigurationHash: string,
  ): Promise<SshFileReadResult>;
  list(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    maxEntries: number,
    expectedConfigurationHash: string,
  ): Promise<SshFileListResult>;
  search(
    context: ToolContext,
    connectionId: number,
    request: {
      query: string;
      path: string;
      glob?: string;
      maxResults: number;
      contextLines: number;
      maxOutputBytes: number;
    },
    expectedConfigurationHash: string,
  ): Promise<SshFileSearchResult>;
  write(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    content: Uint8Array,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<SshFileMutationResult>;
  move(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    destinationPath: string,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<SshFileMoveResult>;
  delete(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    recursive: boolean,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<SshFileDeleteResult>;
  replace(
    context: ToolContext,
    connectionId: number,
    replacements: readonly SshFileReplacement[],
    expectedConfigurationHash: string,
  ): Promise<SshFileReplacementResult[]>;
}
