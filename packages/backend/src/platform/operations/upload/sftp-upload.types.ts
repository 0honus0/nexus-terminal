import type { ExecutionSession } from '../../execution/execution-session';
import type { FileEntry } from '../../filesystem/types';

export type UploadConflictPolicy = 'ask' | 'overwrite' | 'skip';

export interface SftpUploadContext {
  ownerKey: string;
  session: ExecutionSession;
  emit: SftpUploadEventSink;
}

export interface UploadErrorEvent {
  type: 'error';
  uploadId?: string;
  message: string;
}

export interface UploadConflictEvent {
  type: 'conflict';
  uploadId: string;
  remotePath: string;
  filename: string;
}

export interface UploadSkippedEvent {
  type: 'skipped';
  uploadId: string;
  remotePath: string;
}

export interface UploadReadyEvent {
  type: 'ready';
  uploadId: string;
}

export interface UploadChunkAckEvent {
  type: 'chunk-ack';
  uploadId: string;
  chunkIndex: number;
  bytesWritten: number;
  totalSize: number;
  progress: number;
}

export interface UploadSuccessEvent {
  type: 'success';
  uploadId: string;
  remotePath: string;
  item: FileEntry;
}

export interface UploadCancelledEvent {
  type: 'cancelled';
  uploadId: string;
}

export type SftpUploadEvent =
  | UploadErrorEvent
  | UploadConflictEvent
  | UploadSkippedEvent
  | UploadReadyEvent
  | UploadChunkAckEvent
  | UploadSuccessEvent
  | UploadCancelledEvent;

export type SftpUploadEventSink = (event: SftpUploadEvent) => void;
