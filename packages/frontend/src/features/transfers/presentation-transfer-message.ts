import type { TransferTask } from './model/transfer-types';

export interface TransferMessageDescriptor {
	key: string;
	params?: Record<string, string | number>;
}

export const transferTaskErrorDescriptor = (task: TransferTask): TransferMessageDescriptor | null => {
	switch (task.errorKind) {
		case 'upload_unknown':
			return { key: 'progressCenter.error.uploadUnknown' };
		case 'upload_protocol_error':
			return { key: 'progressCenter.error.uploadProtocolError' };
		case 'upload_not_connected':
			return { key: 'progressCenter.error.uploadNotConnected' };
		case 'upload_failed':
			return { key: 'progressCenter.error.uploadFailed' };
		case 'transfer_unknown':
			return { key: 'progressCenter.error.transferUnknown' };
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

/** Failed outcomes are delivered through Toast; task settlement stays in the controller. */
export const isProgressTaskVisible = (task: TransferTask): boolean =>
	task.status !== 'error' && task.status !== 'unknown';
