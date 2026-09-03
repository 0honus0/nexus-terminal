import type { ExecutionSession } from '../../execution/execution-session';
import type { FileEntry } from '../../filesystem/types';

export interface SftpTransferProgressEvent {
  type: 'progress';
  requestId: string;
  transferredBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  totalKnown: boolean;
  currentFile?: string;
}

export interface SftpTransferCancellingEvent {
  type: 'cancelling';
  requestId: string;
}

export interface SftpTransferCancelledEvent {
  type: 'cancelled';
  requestId: string;
}

export interface SftpCopySuccessEvent {
  type: 'copy-success';
  requestId: string;
  destination: string;
  items: FileEntry[];
  sourceOwnerKey?: string;
  crossHost?: boolean;
}

export interface SftpCopyErrorEvent {
  type: 'copy-error';
  requestId: string;
  message: string;
}

export interface SftpMoveSuccessEvent {
  type: 'move-success';
  requestId: string;
  sources: string[];
  destination: string;
  items: FileEntry[];
}

export interface SftpMoveErrorEvent {
  type: 'move-error';
  requestId: string;
  message: string;
}

export type SftpTransferEvent =
  | SftpTransferProgressEvent
  | SftpTransferCancellingEvent
  | SftpTransferCancelledEvent
  | SftpCopySuccessEvent
  | SftpCopyErrorEvent
  | SftpMoveSuccessEvent
  | SftpMoveErrorEvent;

export type SftpTransferEventSink = (event: SftpTransferEvent) => void;

export interface SftpTransferContext {
  ownerKey: string;
  session: ExecutionSession;
  emit: SftpTransferEventSink;
}

export interface SftpCrossCopySource {
  ownerKey: string;
  session: ExecutionSession;
}

export interface SftpTransferCancelResult {
  active: boolean;
}
