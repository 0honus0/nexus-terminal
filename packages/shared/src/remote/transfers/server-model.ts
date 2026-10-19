import type {
	ServerTransferMethod,
	ServerTransferMethodUsed,
	ServerTransferTaskStatus,
	ServerTransferItemStatus,
	ServerTransferErrorCode,
} from './server-values.js';

export interface ServerTransferSource {
	name: string;
	path: string;
	type: 'file' | 'directory';
}

export interface ServerTransferInput {
	sourceConnectionId: number;
	connectionIds: number[];
	sourceItems: ServerTransferSource[];
	remoteTargetPath: string;
	transferMethod: ServerTransferMethod;
}

export interface ServerTransferItem {
	subTaskId: string;
	connectionId: number;
	sourceItemIndex: number;
	status: ServerTransferItemStatus;
	progress: number;
	error: ServerTransferErrorCode | null;
	transferMethodUsed: ServerTransferMethodUsed | null;
}

/** Unix milliseconds; no credentials, raw tool output or authenticated identity. */
export interface ServerTransferSnapshot {
	taskId: string;
	status: ServerTransferTaskStatus;
	createdAt: number;
	updatedAt: number;
	overallProgress: number;
	payload: ServerTransferInput;
	subTasks: ServerTransferItem[];
}
