export type FileTransferOperation = 'copy' | 'move';
export type FileTransferStatus = 'preparing' | 'running' | 'cancelling' | 'cancelled' | 'deleting' | 'error';

export interface FileTransferItem {
  id: string;
  operation: FileTransferOperation;
  crossHost: boolean;
  status: FileTransferStatus;
  label: string;
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  totalKnown: boolean;
  currentFile?: string;
  error?: string;
}
