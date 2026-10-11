import type { RemoteFileWriteStatus } from './values.js';
import type { RemoteFileEntry, RemoteFileInfo, RemoteFileResourceView } from './model.js';
import type { RemoteFileErrorCode } from './values.js';

export interface RemoteFileOpenRequest {
	targetId: number;
}

export interface RemoteFilePathRequest {
	path: string;
}

export interface RemoteFileWriteTextRequest {
	path: string;
	text: string;
	expectedSha256: string | null;
}

export interface RemoteFileRenameRequest {
	from: string;
	to: string;
}

export type RemoteFileOpenResponse = RemoteFileResourceView;

export interface RemoteFileListResponse {
	entries: RemoteFileEntry[];
	complete: true;
}

export interface RemoteFileStatResponse {
	info: RemoteFileInfo;
}

export interface RemoteFileTextResponse {
	info: RemoteFileInfo;
	bytes: number;
	sha256: string;
	text: string;
}

export interface RemoteFileWriteTextResponse {
	status: RemoteFileWriteStatus;
	info: RemoteFileInfo;
	bytes: number;
	sha256: string;
}

export interface RemoteFileRenameResponse {
	from: string;
	to: string;
	kind: Exclude<RemoteFileInfo['kind'], 'other'>;
}

export interface RemoteFileRemoveResponse {
	path: string;
	kind: Exclude<RemoteFileInfo['kind'], 'directory' | 'other'>;
	removed: true;
}

export interface RemoteFileCreateDirectoryResponse {
	path: string;
	created: true;
}

export interface RemoteFileRemoveDirectoryResponse {
	path: string;
	removed: true;
}

export interface RemoteFileCloseResponse {
	closed: true;
}

export interface RemoteFileErrorResponse {
	code: RemoteFileErrorCode;
}
