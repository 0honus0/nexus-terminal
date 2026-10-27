import type { ServerTransferMethodUsed } from '@nexus-terminal/shared/remote/transfers/server-values';
import type { ComputedRef, Ref } from 'vue';
import type {
	WorkspaceUploadConflictPolicy,
	WorkspaceCopyMoveMode,
	WorkspaceArchiveFormat,
} from '@nexus-terminal/shared/remote/transfers/values';
import type { WorkspaceArchiveErrorCode } from '@nexus-terminal/shared/remote/transfers/values';

export type { WorkspaceArchiveErrorCode };

export type TransferKind = 'upload' | 'copy' | 'move' | 'compress' | 'decompress' | 'transfer';

export type TransferErrorKind =
	| 'upload_unknown'
	| 'upload_protocol_error'
	| 'upload_not_connected'
	| 'upload_failed'
	| 'transfer_unknown'
	| 'transfer_failed'
	| 'workspace_connection_closed'
	| 'archive_failed';

export type TransferWarningKind = 'archive_completed_with_warning' | 'partial_failure';

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
	| 'unknown'
	| 'error';

export class TransferFailure extends Error {
	constructor(
		readonly code:
			| 'invalid_input'
			| 'not_connected'
			| 'limit_exceeded'
			| 'protocol_error'
			| 'operation_unknown'
			| 'remote_rejected',
		readonly outcomeUnknown: boolean,
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'TransferFailure';
	}
}

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
	transferMethodUsed?: ServerTransferMethodUsed;
	error?: string;
	errorKind?: TransferErrorKind;
	errorCode?: WorkspaceArchiveErrorCode;
	warning?: string;
	warningKind?: TransferWarningKind;
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
	conflictStrategy?: WorkspaceUploadConflictPolicy;
}

export interface CopyMoveCommand {
	id: string;
	kind: WorkspaceCopyMoveMode;
	sources: TransferLocation[];
	destination: TransferLocation;
}

export interface ArchiveCommand {
	id: string;
	kind: 'compress' | 'decompress';
	sources: TransferLocation[];
	destination: TransferLocation;
	format?: WorkspaceArchiveFormat;
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
			transferMethodUsed?: ServerTransferMethodUsed;
	  }
	| { type: 'completed'; id: string; warning?: string; warningKind?: TransferWarningKind }
	| { type: 'paused'; id: string }
	| { type: 'resumed'; id: string }
	| { type: 'skipped'; id: string }
	| { type: 'cancelled'; id: string }
	| {
			type: 'error';
			id: string;
			message?: string;
			errorKind?: TransferErrorKind;
			code?: WorkspaceArchiveErrorCode;
	  }
	| { type: 'conflict'; id: string; path: string };

export type ConflictStrategy = Exclude<WorkspaceUploadConflictPolicy, 'ask'>;

export interface UploadConflict {
	id: string;
	path: string;
	batchId: string;
}

export interface TransferController {
	tasks: Ref<TransferTask[]>;
	active: ComputedRef<TransferTask[]>;
	conflict: ComputedRef<UploadConflict | null>;
	startUploadBatch(
		sources: readonly (File | UploadSourceFile)[],
		destination: TransferLocation,
		directories?: readonly string[],
	): Promise<string[]>;
	copyMove(request: Omit<CopyMoveCommand, 'id'>): Promise<string>;
	archive(request: Omit<ArchiveCommand, 'id'>): Promise<string>;
	cancel(id: string): Promise<void>;
	cancelAll(): Promise<void>;
	resolveConflict(strategy: ConflictStrategy, applyToAll?: boolean): Promise<void>;
	waitForTask(id: string): Promise<TransferTask>;
	remove(id: string): void;
	dispose(): void;
}
