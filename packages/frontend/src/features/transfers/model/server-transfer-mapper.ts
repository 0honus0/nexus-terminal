import type { ServerTransferSnapshot } from '@nexus-terminal/shared/remote/transfers/server-model';
import type { ServerTransferTask } from './server-transfer-types';
import type { TransferTask } from './transfer-types';

export function toServerTransferTask(task: ServerTransferSnapshot): ServerTransferTask {
	return {
		taskId: task.taskId,
		status: task.status,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		overallProgress: task.overallProgress,
		payload: {
			sourceConnectionId: task.payload.sourceConnectionId,
			connectionIds: task.payload.connectionIds.map((id) => id),
			sourceItems: task.payload.sourceItems.map((item) => ({
				name: item.name,
				path: item.path,
				type: item.type,
			})),
			remoteTargetPath: task.payload.remoteTargetPath,
			transferMethod: task.payload.transferMethod,
		},
		subTasks: task.subTasks.map((item) => {
			const source = task.payload.sourceItems[item.sourceItemIndex];
			if (!source) {
				throw new Error('Transfer source missing');
			}
			return {
				subTaskId: item.subTaskId,
				connectionId: item.connectionId,
				sourceItemIndex: item.sourceItemIndex,
				sourceItemName: source.name,
				status: item.status,
				progress: item.progress,
				error: item.error,
				transferMethodUsed: item.transferMethodUsed,
			};
		}),
	};
}

export function toTransferTask(task: ServerTransferTask): TransferTask {
	const status =
		task.status === 'in-progress'
			? 'running'
			: task.status === 'partially-completed'
				? 'partial'
				: task.status === 'failed'
					? 'error'
					: task.status;
	const names = task.payload.sourceItems.map((item) => item.name);
	const methods = new Set(task.subTasks.map((item) => item.transferMethodUsed).filter((item) => item !== null));
	return {
		id: task.taskId,
		kind: 'transfer',
		label: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' +' + (names.length - 3) : ''} → ${task.payload.remoteTargetPath}`,
		status,
		progress: task.overallProgress,
		transferMethodUsed: methods.size === 1 ? methods.values().next().value : undefined,
		bytesWritten: 0,
		totalBytes: 0,
		completedFiles: task.subTasks.filter((item) => item.status === 'completed').length,
		totalFiles: task.subTasks.length,
		createdAt: task.createdAt,
		errorKind: status === 'unknown' ? 'transfer_unknown' : status === 'error' ? 'transfer_failed' : undefined,
	};
}
