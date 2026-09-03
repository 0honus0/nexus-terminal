import type { ExecutionSession } from '../execution/execution-session';

export type ArchiveFormat = 'zip' | 'targz' | 'tarbz2';
export type ArchiveOperationKind = 'compress' | 'decompress';

export interface CompressArchiveRequest {
  sources: string[];
  destinationArchiveName: string;
  format: ArchiveFormat;
  targetDirectory: string;
  password?: string;
  requestId: string;
}

export interface DecompressArchiveRequest {
  archivePath: string;
  password?: string;
  requestId: string;
}

export type CompressArchiveErrorCode = 'PASSWORD_TOO_LONG' | 'INVALID_PASSWORD_FORMAT';
export type DecompressArchiveErrorCode =
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'PASSWORD_TOO_LONG'
  | 'INVALID_PASSWORD_FORMAT';

export interface ArchiveProgressEvent {
  type: 'progress';
  operation: ArchiveOperationKind;
  requestId: string;
  fileCount: number;
  totalFiles?: number;
  percent?: number;
  currentFile?: string;
}

export interface ArchiveSuccessEvent {
  type: 'success';
  operation: ArchiveOperationKind;
  requestId: string;
  message: string;
  warning?: string;
}

export interface ArchiveErrorEvent {
  type: 'error';
  operation: ArchiveOperationKind;
  requestId: string;
  error: string;
  details?: string;
  code?: CompressArchiveErrorCode | DecompressArchiveErrorCode;
  commandNotFound?: string;
}

export type ArchiveOperationEvent = ArchiveProgressEvent | ArchiveSuccessEvent | ArchiveErrorEvent;
export type ArchiveEventSink = (event: ArchiveOperationEvent) => void;

export interface ArchiveOperationContext {
  ownerKey: string;
  session: ExecutionSession;
  emit: ArchiveEventSink;
}

export interface ArchiveCancelResult {
  found: boolean;
  cleaned: boolean;
}
