import type { WorkspaceArchiveFormat } from '@nexus-terminal/shared/remote/transfers/values';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';
import type { RemoteFileTargetType } from '@nexus-terminal/shared/remote/files/values';

export interface RemoteFileMetadata {
	size: number;
	uid: number;
	gid: number;
	mode: number;
	accessedAt: number;
	modifiedAt: number;
	isFile: boolean;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}

export interface RemoteFileEntry {
	name: string;
	path: string;
	longName?: string;
	metadata: RemoteFileMetadata;
}

export interface RemoteFileSearchEntry extends RemoteFileEntry {
	relativePath: string;
}

export interface DirectoryListing {
	path: string;
	entries: RemoteFileEntry[];
}

export type FilesystemInvalidation =
	{ type: 'mutation' } | { type: 'unavailable'; code: WorkspaceErrorCode | 'not_connected' };

export interface FileSearchResult {
	entries: RemoteFileSearchEntry[];
	truncated: boolean;
}

export interface ResolvedRemotePath {
	requestedPath: string;
	path: string;
	targetType: RemoteFileTargetType;
}

export interface LocalUploadFile {
	file: File;
	relativeDirectory?: string;
}

export interface LocalUploadBatch {
	files: LocalUploadFile[];
	directories: string[];
}

export type ArchiveCompressionFormat = WorkspaceArchiveFormat;

export interface ArchiveCompressionIntent {
	entries: RemoteFileEntry[];
	format: ArchiveCompressionFormat;
	passwordProtected?: boolean;
}

export class FilesystemFailure extends Error {
	constructor(
		readonly code: WorkspaceErrorCode | 'not_connected' | 'protocol_error',
		readonly outcomeUnknown: boolean,
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'FilesystemFailure';
	}
}
