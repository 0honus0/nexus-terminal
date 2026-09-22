import type { WorkspaceArchiveErrorCodeDto } from '@nexus-terminal/protocol/workspace';
export type { WorkspaceArchiveErrorCodeDto };

export type TransferKind = 'upload' | 'copy' | 'move' | 'compress' | 'decompress' | 'transfer';
export type TransferStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'skipped'
  | 'completed'
  | 'partial'
  | 'error';

export interface TransferLocation {
  scopeId: string;
  path: string;
}

export interface ProgressSource {
  id: string;
  label: string;
  tasks: readonly TransferTask[];
  restorable?: boolean;
}

export interface TransferTask {
  id: string;
  kind: TransferKind;
  label: string;
  status: TransferStatus;
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number | null;
  currentFile?: string;
  error?: string;
  errorCode?: WorkspaceArchiveErrorCodeDto;
  warning?: string;
  createdAt: number;
}

export interface UploadSourceFile {
  file: File;
  relativeDirectory?: string;
}

export interface UploadPrepareCommand {
  id: string;
  destination: TransferLocation;
  directories: readonly string[];
}

export interface UploadCommand {
  id: string;
  file: File;
  destination: TransferLocation;
  relativeDirectory?: string;
  prepareId?: string;
  conflictStrategy?: 'ask' | 'overwrite' | 'skip';
}

export interface CopyMoveCommand {
  id: string;
  kind: 'copy' | 'move';
  sources: TransferLocation[];
  destination: TransferLocation;
}

export interface ArchiveCommand {
  id: string;
  kind: 'compress' | 'decompress';
  sources: TransferLocation[];
  destination: TransferLocation;
  format?: 'zip' | 'tar.gz' | 'tar.bz2';
  password?: string;
}

export type TransferEvent =
  | { type: 'task'; task: TransferTask }
  | {
      type: 'progress';
      id: string;
      progress: number;
      bytesWritten?: number;
      totalBytes?: number;
      completedFiles?: number;
      totalFiles?: number | null;
      currentFile?: string;
    }
  | { type: 'completed'; id: string; warning?: string }
  | { type: 'paused'; id: string }
  | { type: 'resumed'; id: string }
  | { type: 'skipped'; id: string }
  | { type: 'cancelled'; id: string }
  | { type: 'error'; id: string; message: string; code?: WorkspaceArchiveErrorCodeDto }
  | { type: 'conflict'; id: string; path: string };
