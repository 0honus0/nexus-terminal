import type { WorkspaceFileEntry } from '../files/workspace.js';

import type {
	WorkspaceCopyMoveMode,
	WorkspaceArchiveFormat,
	WorkspaceArchiveOperation,
	WorkspaceUploadConflictPolicy,
	WorkspaceArchiveErrorCode,
} from './values.js';

export interface WorkspaceCopyMoveRequest {
	mode: WorkspaceCopyMoveMode;
	sources: string[];
	destination: string;
	sourceWorkspaceId?: string;
}

export interface WorkspaceTaskCancelRequest {
	taskId: string;
}

export interface WorkspaceTaskStarted {
	started: true;
}

export interface WorkspaceArchiveCompressRequest {
	sources: string[];
	destination: string;
	format: WorkspaceArchiveFormat;
	password?: string;
}

export interface WorkspaceArchiveDecompressRequest {
	source: string;
	password?: string;
}

export type WorkspaceArchiveEvent =
	| {
			type: 'progress';
			operation: WorkspaceArchiveOperation;
			requestId: string;
			fileCount: number;
			totalFiles?: number;
			percent?: number;
			currentFile?: string;
	  }
	| {
			type: 'completed';
			operation: WorkspaceArchiveOperation;
			requestId: string;
			path: string;
			warning?: string;
	  }
	| {
			type: 'failed';
			operation: WorkspaceArchiveOperation;
			requestId: string;
			message: string;
			code?: WorkspaceArchiveErrorCode;
			commandNotFound?: string;
	  }
	| { type: 'cancelled'; operation: WorkspaceArchiveOperation; requestId: string };

export type WorkspaceCopyMoveEvent =
	| {
			type: 'progress';
			requestId: string;
			transferredBytes: number;
			totalBytes: number;
			completedFiles: number;
			totalFiles: number;
			totalKnown: boolean;
			currentFile?: string;
	  }
	| {
			type: 'completed';
			requestId: string;
			mode: WorkspaceCopyMoveMode;
			sourcePaths: readonly string[];
			destinationPath: string;
			items: WorkspaceFileEntry[];
			crossSession: boolean;
			sourceOwnerId?: string;
	  }
	| { type: 'failed'; requestId: string; mode: WorkspaceCopyMoveMode; message: string }
	| { type: 'cancelling'; requestId: string }
	| { type: 'cancelled'; requestId: string };

export interface WorkspaceUploadPrepare {
	prepareId: string;
	basePath: string;
	directories: string[];
}

export interface WorkspaceUploadStart {
	uploadId: string;
	destinationPath: string;
	size: number;
	conflictPolicy?: WorkspaceUploadConflictPolicy;
	prepareId?: string;
	relativePath?: string;
}

export interface WorkspaceUploadSession {
	uploadId: string;
}

export interface WorkspaceUploadAbort extends WorkspaceUploadSession {
	message: string;
}

export interface WorkspaceUploadStream {
	workspaceId: string;
	uploadId: string;
	size: number;
}

export type WorkspaceUploadEvent =
	| { type: 'ready'; uploadId: string }
	| { type: 'conflict'; uploadId: string; destinationPath: string; filename: string }
	| { type: 'skipped'; uploadId: string; destinationPath: string }
	| {
			type: 'progress';
			uploadId: string;
			chunkIndex: number;
			bytesWritten: number;
			totalSize: number;
			progress: number;
	  }
	| { type: 'completed'; uploadId: string; destinationPath: string; item: WorkspaceFileEntry }
	| { type: 'cancelled'; uploadId: string }
	| { type: 'failed'; uploadId: string; message: string };
