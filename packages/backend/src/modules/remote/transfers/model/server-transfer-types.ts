import type {
	ServerTransferErrorCode,
	ServerTransferMethod,
	ServerTransferMethodUsed,
	ServerTransferTaskStatus,
	ServerTransferItemStatus,
} from '@nexus-terminal/shared/remote/transfers/server-values';
import { MachineMutationRejection } from '../../machines/model/mutation-types.js';

export interface ServerTransferCommand {
	sourceConnectionId: number;
	connectionIds: number[];
	sourceItems: { name: string; path: string; type: 'file' | 'directory' }[];
	remoteTargetPath: string;
	transferMethod: ServerTransferMethod;
}

export interface ServerTransferSubTask {
	subTaskId: string;
	connectionId: number;
	sourceItemIndex: number;
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
	payload: ServerTransferCommand;
	subTasks: ServerTransferSubTask[];
}

export interface ServerTransferPlan {
	source: { targetId: number; fingerprint: string };
	targets: {
		targetId: number;
		fingerprint: string;
		hostKeyFingerprint: string | null;
		pinKey: string;
		direct: boolean;
	}[];
	sourcePin: { key: string; fingerprint: string | null };
	/** Canonical machine footprints used only for local scheduling, never authorization. */
	resources: string[];
}

export interface ServerTransferExecution {
	executionId: string;
	command: ServerTransferCommand;
	plan: ServerTransferPlan;
	targetId: number;
	sourceIndex: number;
	deadline: number;
	signal: AbortSignal;
	validate(): Promise<void>;
	onMethod(method: ServerTransferMethodUsed): void;
}

export class ServerTransferFailure extends MachineMutationRejection {
	constructor(
		readonly code: ServerTransferErrorCode,
		outcome: 'not_started' | 'failed' | 'unknown' = 'not_started',
		options?: ErrorOptions,
	) {
		super('Server transfer ' + code, outcome, options);
	}
}
