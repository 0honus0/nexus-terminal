import type {
	ServerTransferErrorCode,
	ServerTransferMethod,
	ServerTransferMethodUsed,
	ServerTransferTaskStatus,
	ServerTransferItemStatus,
} from '@nexus-terminal/shared/remote/transfers/server-values';

export interface SendFileSource {
	name: string;
	path: string;
	type: 'file' | 'directory';
}

export interface SendFilesCommand {
	sourceConnectionId: number;
	connectionIds: number[];
	sourceItems: SendFileSource[];
	remoteTargetPath: string;
	transferMethod: ServerTransferMethod;
}

export interface ServerTransferSubTask {
	subTaskId: string;
	connectionId: number;
	sourceItemIndex: number;
	sourceItemName: string;
	status: ServerTransferItemStatus;
	progress: number;
	error: ServerTransferErrorCode | null;
	transferMethodUsed: ServerTransferMethodUsed | null;
}

export interface ServerTransferTask {
	taskId: string;
	status: ServerTransferTaskStatus;
	createdAt: number;
	updatedAt: number;
	overallProgress: number;
	payload: SendFilesCommand;
	subTasks: ServerTransferSubTask[];
}

export class ServerTransferRequestFailure extends Error {
	constructor(
		readonly code: ServerTransferErrorCode | 'request_failed' | 'protocol_failure',
		readonly outcome: 'not_dispatched' | 'confirmed' | 'unknown',
		options?: ErrorOptions,
	) {
		super('Server transfer request failed', options);
	}
}
