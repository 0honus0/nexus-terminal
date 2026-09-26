import type { TransferTask } from './model/transfer';

export interface TransferMessageDescriptor {
  key: string;
  params?: Record<string, string | number>;
}

export const transferTaskErrorDescriptor = (task: TransferTask): TransferMessageDescriptor | null => {
  switch (task.errorKind) {
    case 'upload_directory_state_lost':
      return { key: 'progressCenter.error.uploadDirectoryStateLost' };
    case 'upload_stream_closed':
      return {
        key: 'progressCenter.error.uploadStreamClosed',
        ...(task.errorContext?.closeCode !== undefined ? { params: { code: task.errorContext.closeCode } } : {}),
      };
    case 'upload_stream_open_failed':
      return {
        key: 'progressCenter.error.uploadStreamOpenFailed',
        ...(task.errorContext?.fileName ? { params: { file: task.errorContext.fileName } } : {}),
      };
    case 'upload_failed':
      return { key: 'progressCenter.error.uploadFailed' };
    case 'transfer_failed':
      return { key: 'progressCenter.error.transferFailed' };
    case 'workspace_connection_closed':
      return { key: 'progressCenter.error.workspaceConnectionClosed' };
    case 'archive_failed':
      return { key: 'progressCenter.error.archiveFailed' };
    default:
      return task.error ? { key: 'progressCenter.error.unknown' } : null;
  }
};

export const transferTaskWarningDescriptor = (task: TransferTask): TransferMessageDescriptor | null => {
  switch (task.warningKind) {
    case 'archive_completed_with_warning':
      return { key: 'progressCenter.warning.archiveCompletedWithWarning' };
    case 'partial_failure':
      return { key: 'progressCenter.warning.partialFailure' };
    default:
      return task.warning ? { key: 'progressCenter.warning.partialFailure' } : null;
  }
};
