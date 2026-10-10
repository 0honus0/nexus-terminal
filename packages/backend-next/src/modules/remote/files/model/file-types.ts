import type { RemoteFileErrorCode, RemoteFileKind } from '@nexus-terminal/shared/remote/files/values';

export class RemoteFileFailure extends Error {
	constructor(readonly code: RemoteFileErrorCode) {
		super('Remote file operation: ' + code);
	}
}

export interface FileResource {
	readonly targetId: number;
	readonly fingerprint: string;
	readonly isOpen: boolean;
	list(request: FileListRequest): Promise<FileEntry[]>;
	stat(request: FileStatRequest): Promise<FileInfo>;
	readText(request: FileTextRequest): Promise<TextRead>;
	close(): Promise<void>;
}

export interface FileOperationRequest {
	path: string;
	timeoutMs: number;
	signal: AbortSignal;
}

export interface FileListRequest extends FileOperationRequest {
	maxEntries: number;
	maxMetadataBytes: number;
}

export interface FileStatRequest extends FileOperationRequest {
	followLinks: boolean;
}

export interface FileTextRequest extends FileOperationRequest {
	maxBytes: number;
}

export interface FileInfo {
	size: number;
	mode: number;
	modifiedAt: number;
	kind: RemoteFileKind;
}

export interface FileEntry {
	name: string;
	info: FileInfo;
}

export interface TextRead {
	text: string;
	bytes: number;
	info: FileInfo;
}

/** Files application result consumed by the HTTP projection. */
export interface OpenedFile {
	id: string;
	targetId: number;
	fingerprint: string;
}
