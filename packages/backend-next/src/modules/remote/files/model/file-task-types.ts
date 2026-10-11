import type {
	WorkspaceCopyMoveMode,
	WorkspaceArchiveOperation,
	WorkspaceArchiveErrorCode,
	WorkspaceArchiveFormat,
} from '@nexus-terminal/shared/remote/transfers/values';
import type { FilePathEntry, RemoteFileFailure } from './file-types.js';

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
	| { type: 'failed'; requestId: string; mode: WorkspaceCopyMoveMode; message: string }
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
			message: string;
			code?: FileArchiveErrorCode;
			commandNotFound?: string;
	  }
	| { type: 'cancelled'; operation: FileArchiveOperation; requestId: string };

export interface CopyProgress {
	transferredBytes: number;
	completedFiles: number;
	currentFile: string;
}

export type FileArchiveRequest =
	| { kind: 'compress'; sources: readonly string[]; destination: string; format: ArchiveFormat; password?: string }
	| { kind: 'decompress'; source: string; password?: string };

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
