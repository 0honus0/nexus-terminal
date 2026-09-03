export type ArchiveFormat = 'zip' | 'targz' | 'tarbz2';
export type ArchiveOperationKind = 'compress' | 'decompress';

export type ArchiveErrorCode =
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'PASSWORD_TOO_LONG'
  | 'INVALID_PASSWORD_FORMAT'
  | 'COMMAND_NOT_FOUND'
  | 'UNSUPPORTED_FORMAT';

export interface CompressArchiveRequest {
  ownerId: string;
  sessionId: string;
  requestId: string;
  sourcePaths: readonly string[];
  destinationPath: string;
  format: ArchiveFormat;
  password?: string;
}

export interface DecompressArchiveRequest {
  ownerId: string;
  sessionId: string;
  requestId: string;
  archivePath: string;
  password?: string;
}

export type ArchiveEvent =
  | {
      type: 'progress';
      operation: ArchiveOperationKind;
      requestId: string;
      fileCount: number;
      totalFiles?: number;
      percent?: number;
      currentFile?: string;
    }
  | { type: 'completed'; operation: ArchiveOperationKind; requestId: string; path: string; warning?: string }
  | {
      type: 'failed';
      operation: ArchiveOperationKind;
      requestId: string;
      message: string;
      details?: string;
      code?: ArchiveErrorCode;
      commandNotFound?: string;
    }
  | { type: 'cancelled'; operation: ArchiveOperationKind; requestId: string };

export interface ArchiveOperation {
  compress(request: CompressArchiveRequest, emit: (event: ArchiveEvent) => void): Promise<void>;
  decompress(request: DecompressArchiveRequest, emit: (event: ArchiveEvent) => void): Promise<void>;
  cancel(ownerId: string, requestId: string): Promise<boolean>;
  cancelOwner(ownerId: string): Promise<void>;
}
