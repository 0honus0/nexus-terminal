import type {
	ServerTransferMethod,
	ServerTransferMethodUsed,
} from '@nexus-terminal/shared/remote/transfers/server-values';
import type {
	WorkspaceCopyMoveMode,
	WorkspaceArchiveOperation,
	WorkspaceArchiveErrorCode,
	WorkspaceArchiveFormat,
} from '@nexus-terminal/shared/remote/transfers/values';
import type { RemoteFileErrorCode } from '@nexus-terminal/shared/remote/files/values';
import { RemoteFileFailure, type FilePathEntry } from './file-types.js';
import type { RemoteResourceCleanupFailure } from '../../resource-errors.js';

export type FileCopyMoveEvent =
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
			items: FilePathEntry[];
			crossSession: boolean;
			sourceOwnerId?: string;
	  }
	| { type: 'failed'; requestId: string; mode: WorkspaceCopyMoveMode; message: RemoteFileErrorCode }
	| { type: 'cancelling'; requestId: string }
	| { type: 'cancelled'; requestId: string };

export type FileArchiveOperation = WorkspaceArchiveOperation;

export type FileArchiveErrorCode = WorkspaceArchiveErrorCode;

export type ArchiveFormat = WorkspaceArchiveFormat;

export type FileArchiveEvent =
	| {
			type: 'progress';
			operation: FileArchiveOperation;
			requestId: string;
			fileCount: number;
			totalFiles?: number;
			percent?: number;
			currentFile?: string;
	  }
	| { type: 'completed'; operation: FileArchiveOperation; requestId: string; path: string; warning?: string }
	| {
			type: 'failed';
			operation: FileArchiveOperation;
			requestId: string;
			message: RemoteFileErrorCode | FileArchiveErrorCode;
			code?: FileArchiveErrorCode;
			commandNotFound?: string;
	  }
	| { type: 'cancelled'; operation: FileArchiveOperation; requestId: string };

export interface FileDirectCopyRequest {
	sourceTargetId: number;
	sourceFingerprint: string;
	targetId: number;
	targetFingerprint: string;
	sourcePath: string;
	mode: 'copy' | 'move';
	directory: boolean;
	method: ServerTransferMethod;
	destinationDirectory: string;
	deadline: number;
	signal: AbortSignal;
	validate(): Promise<void>;
	onProgress(bytes: number, percent: number): void;
	onMethod(method: ServerTransferMethodUsed): void;
	onMutation(): void;
}

export type FileDirectCopy = (
	sourcePath: string,
	directory: boolean,
	onProgress: (bytes: number) => void,
	onMutation: () => void,
) => Promise<boolean>;

export interface CopyProgress {
	totalBytes: number;
	totalFiles: number;
	totalKnown: boolean;
	transferredBytes: number;
	completedFiles: number;
	currentFile: string;
}

export type FileArchiveRequest =
	| { kind: 'compress'; sources: readonly string[]; destination: string; format: ArchiveFormat; password?: string }
	| { kind: 'decompress'; source: string; password?: string };

/** A bounded compression read/write set; directories and aliases use the exclusive queue. */
export interface FileCompressionFootprint {
	directory: string;
	sources: readonly string[];
	destination: string;
}

export interface TransferResourceOwner {
	finished: boolean;
	cleanupFailure: RemoteResourceCleanupFailure | null;
	readonly cleanupOwnerIds: readonly string[];
}

export type FileMutationIntent =
	| { kind: 'upload'; destination: string }
	| { kind: 'compression'; sources: readonly string[]; destination: string; owner: TransferResourceOwner };

/** The native writer exited, its private output was discarded, and publication never began. */
export class FileArchiveDiscarded extends RemoteFileFailure {
	constructor(options?: ErrorOptions) {
		super('remote_unavailable', options);
		this.name = 'FileArchiveDiscarded';
	}
}

export class ArchiveRejection extends Error {
	constructor(
		readonly code: FileArchiveErrorCode,
		readonly commandNotFound?: string,
	) {
		super('Archive ' + code);
		this.name = 'ArchiveRejection';
	}
}

export type FileZipEntry =
	{ kind: 'directory'; name: string } | { kind: 'file'; name: string; bytes: AsyncIterable<Uint8Array> };

export type FileArchiveCommandOutcome =
	{ status: 'completed' } | { status: 'rejected'; failure: RemoteFileFailure | ArchiveRejection };

export interface FileArchiveCompression {
	outcome: FileArchiveCommandOutcome;
	count: number;
	finished: boolean;
	writerExited: boolean;
}

export interface FileArchiveExtraction {
	outcome: FileArchiveCommandOutcome;
	done: boolean;
}

export interface FileArchiveMember {
	name: string;
	kind: 'file' | 'directory' | 'symlink' | 'hardlink' | 'special';
	size: number;
	/** Null when the archive stores no POSIX permission metadata. */
	mode: number | null;
	linkTarget: string | null;
}

export interface FileArchiveListing {
	names: string[];
	modes: FileArchiveMember[];
}

export interface FileArchiveExtractionPlan {
	snapshot: string;
	stage: string;
	format: ArchiveFormat;
	excludedMembers: readonly string[];
	hasContent: boolean;
}

export type FileArchiveEntry = {
	kind: 'file' | 'directory' | 'symlink';
	size: number;
	mode: number | null;
	rawName: string;
	hardlink: boolean;
	linkTarget: string | null;
};

export type FileArchiveLinkTarget = { destination: string; directories: readonly string[] };

export interface FileArchiveHardlink {
	target: string;
	size: number;
}
