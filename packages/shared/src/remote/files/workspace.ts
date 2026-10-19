import type { RemoteFileTargetType } from './values.js';
import type { WorkspaceErrorCode } from '../workspace/values.js';

export interface WorkspaceFileMetadata {
	size: number;
	uid: number;
	gid: number;
	mode: number;
	/** Unix milliseconds, already converted by the producer's Model. */
	accessedAt: number;
	modifiedAt: number;
	isFile: boolean;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}

export interface WorkspaceFileEntry {
	name: string;
	path: string;
	longName?: string;
	metadata: WorkspaceFileMetadata;
}

export interface WorkspaceFileSearchEntry extends WorkspaceFileEntry {
	relativePath: string;
}

export interface WorkspaceFilePathRequest {
	path: string;
}

export interface WorkspaceFileListResponse {
	path: string;
	entries: WorkspaceFileEntry[];
}

export interface WorkspaceFileSearchRequest {
	path: string;
	query: string;
}

export interface WorkspaceFileSearchResponse {
	entries: WorkspaceFileSearchEntry[];
	truncated: boolean;
}

export interface WorkspaceFileReadBinaryRequest {
	path: string;
	maxBytes: number;
}

export interface WorkspaceFileReadBinaryResponse {
	path: string;
}

export interface WorkspaceFileCancelReadRequest {
	requestId: string;
}

export interface WorkspaceFileWriteTextRequest {
	path: string;
	content: string;
	encoding?: string;
}

export interface WorkspaceFileCreateFileRequest {
	path: string;
	content?: string;
	encoding?: string;
}

export interface WorkspaceFileRemoveRequest {
	paths: string[];
	forceDirectoryPaths?: string[];
}

export interface WorkspaceFileRenameRequest {
	from: string;
	to: string;
}

export interface WorkspaceFileChmodRequest {
	path: string;
	mode: number;
}

export interface WorkspaceFileRealpathResponse {
	requestedPath: string;
	absolutePath: string;
	targetType: RemoteFileTargetType;
}

export interface WorkspaceFileErrorEvent {
	message: WorkspaceErrorCode;
}

export interface WorkspaceFilesRequestMap {
	'filesystem.list': WorkspaceFilePathRequest;
	'filesystem.search': WorkspaceFileSearchRequest;
	'filesystem.stat': WorkspaceFilePathRequest;
	'filesystem.readBinary': WorkspaceFileReadBinaryRequest;
	'filesystem.cancelRead': WorkspaceFileCancelReadRequest;
	'filesystem.writeText': WorkspaceFileWriteTextRequest;
	'filesystem.createDirectory': WorkspaceFilePathRequest;
	'filesystem.createFile': WorkspaceFileCreateFileRequest;
	'filesystem.remove': WorkspaceFileRemoveRequest;
	'filesystem.rename': WorkspaceFileRenameRequest;
	'filesystem.chmod': WorkspaceFileChmodRequest;
	'filesystem.realpath': WorkspaceFilePathRequest;
}

export interface WorkspaceFilesResponseMap {
	'filesystem.list': WorkspaceFileListResponse;
	'filesystem.search': WorkspaceFileSearchResponse;
	'filesystem.stat': WorkspaceFileEntry;
	'filesystem.readBinary': WorkspaceFileReadBinaryResponse;
	'filesystem.cancelRead': boolean;
	'filesystem.writeText': null;
	'filesystem.createDirectory': null;
	'filesystem.createFile': null;
	'filesystem.remove': null;
	'filesystem.rename': null;
	'filesystem.chmod': null;
	'filesystem.realpath': WorkspaceFileRealpathResponse;
}

export interface WorkspaceFilesEventMap {
	'filesystem.ready': Record<string, never>;
	'filesystem.error': WorkspaceFileErrorEvent;
}
