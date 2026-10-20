import type {
	RemoteFileKind,
	RemoteFileWriteStatus,
	RemoteFileTargetType,
} from '@nexus-terminal/shared/remote/files/values';

export type RemoteFileFailureCode =
	| 'unauthenticated'
	| 'forbidden'
	| 'not_found'
	| 'invalid_input'
	| 'stale_target'
	| 'host_key_untrusted'
	| 'limit_exceeded'
	| 'not_text'
	| 'conflict'
	| 'operation_unknown'
	| 'remote_unavailable';

export class RemoteFileFailure extends Error {
	constructor(
		readonly code: RemoteFileFailureCode,
		options?: ErrorOptions,
	) {
		super('Remote file operation: ' + code, options);
		this.name = 'RemoteFileFailure';
	}
}

/** The remote command was certainly not dispatched. */
export class FileCommandNotStarted extends RemoteFileFailure {
	constructor(options?: ErrorOptions) {
		super('remote_unavailable', options);
		this.name = 'FileCommandNotStarted';
	}
}

export interface FileResource {
	readonly targetId: number;
	readonly fingerprint: string;
	readonly isOpen: boolean;
	list(request: FileListRequest): Promise<FileEntry[]>;
	scan(request: FileScanRequest): Promise<FileEntry[]>;
	stat(request: FileStatRequest): Promise<FileInfo>;
	read(request: FileReadRequest): Promise<Uint8Array>;
	openRead(request: FileReadRequest): Promise<FileByteSource>;
	stage(request: FileStageRequest): Promise<FileStagedWrite>;
	openUploadStage(request: FileOperationRequest & { mode?: number }): Promise<FileUploadStage>;
	create(request: FileCreateRequest): Promise<void>;
	rename(request: FileRenameRequest): Promise<void>;
	replace(request: FileRenameRequest): Promise<void>;
	remove(request: FileOperationRequest): Promise<void>;
	mkdir(request: FileOperationRequest): Promise<void>;
	rmdir(request: FileOperationRequest): Promise<void>;
	chmod(request: FileChmodRequest): Promise<void>;
	utimes(request: FileOperationRequest & { accessedAt: number; modifiedAt: number }): Promise<void>;
	realpath(request: FileOperationRequest): Promise<string>;
	readlink(request: FileOperationRequest): Promise<string>;
	symlink(targetPath: string, linkPath: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<void>;
	forceRemove(request: FileForceRemoveRequest): Promise<FileCommandOutcome>;
	executeCommandLines(
		command: string,
		signal: AbortSignal,
		timeoutMs: number,
		onLine: (line: string) => void,
		beforeWriteMarker?: string,
	): Promise<FileLineCommandOutcome>;
	close(): Promise<void>;
}

export interface FileOperationRequest {
	path: string;
	timeoutMs: number;
	signal: AbortSignal;
}

export interface FileScanRequest extends FileOperationRequest {
	/** Optional application budget for one directory's scanned entries. */
	maxEntries?: number;
}

export interface FileListRequest extends FileOperationRequest {
	maxEntries: number;
	maxMetadataBytes: number;
}

export interface FileStatRequest extends FileOperationRequest {
	followLinks: boolean;
}

export interface FileReadRequest extends FileOperationRequest {
	maxBytes: number;
	/** Inclusive byte offset, default zero. */
	start?: number;
	/** Optional fixed length, starting at `start`. */
	length?: number;
}

/** Application delivery capability; HTTP response objects stay in Interface. */
export interface FileDownloadSink<TPlan> {
	plan(value: TPlan): Promise<void>;
	write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
	finish(signal: AbortSignal): Promise<void>;
}

export interface FileDownloadPlan {
	path: string;
	size: number;
	modifiedAt: number;
	partial: boolean;
	start: number;
	end: number;
	length: number;
}

export interface FileStageRequest extends FileOperationRequest {
	bytes: Uint8Array;
	mode?: number;
}

export interface FileCreateRequest extends FileOperationRequest {
	bytes: Uint8Array;
	mode?: number;
}

export interface FileRenameRequest {
	from: string;
	to: string;
	timeoutMs: number;
	signal: AbortSignal;
}

export interface FileChmodRequest extends FileOperationRequest {
	mode: number;
}

export interface FileForceRemoveRequest extends FileOperationRequest {
	privileged: boolean;
}

export type FileCommandOutcome = 'completed' | 'rejected' | 'unknown';

export interface FileByteSource extends AsyncIterable<Uint8Array> {}

export interface FileStagedWrite {
	commit(mode: 'create' | 'replace'): Promise<void>;
	discard(): Promise<void>;
}

/** Model-owned streaming write resource: protocol chunks never reach Platform. */
export interface FileUploadStage {
	append(bytes: Uint8Array): Promise<void>;
	commit(mode: 'create' | 'replace'): Promise<void>;
	discard(): Promise<void>;
}

export interface FileInfo {
	size: number;
	uid: number;
	gid: number;
	mode: number;
	accessedAt: number;
	modifiedAt: number;
	kind: RemoteFileKind;
}

export interface FileEntry {
	name: string;
	longName?: string;
	info: FileInfo;
}

export interface FilePathEntry extends FileEntry {
	path: string;
}

export interface TextRead {
	text: string;
	bytes: number;
	sha256: string;
	info: FileInfo;
}

export interface TextWrite {
	status: RemoteFileWriteStatus;
	bytes: number;
	sha256: string;
	info: FileInfo;
}

export interface FileRenameResult {
	from: string;
	to: string;
	kind: Exclude<RemoteFileKind, 'other'>;
}

export interface FileRemoveResult {
	path: string;
	kind: Exclude<RemoteFileKind, 'directory' | 'other'>;
}

export interface FileDirectoryResult {
	path: string;
}

export interface FileSearchEntry extends FilePathEntry {
	relativePath: string;
}

export interface FileSearchResult {
	items: FileSearchEntry[];
	truncated: boolean;
}

export interface ResolvedFilePath {
	requestedPath: string;
	absolutePath: string;
	targetType: RemoteFileTargetType;
}

/** Files application result consumed by HTTP/Workspace interfaces. */
export interface OpenedFile {
	id: string;
	targetId: number;
	fingerprint: string;
}

/** Internal lifecycle capability; it never crosses an HTTP or Shared boundary. */
export interface FileAttachment extends OpenedFile {
	release(): Promise<void>;
}

/** Workspace-specific application attachment; not a protocol/SSH transport type. */
export interface WorkspaceFileAttachment extends FileAttachment {
	connectionName: string;
}

/** Current Workspace policy, independent of its transport and Access identity. */
export interface WorkspaceFileAuthority {
	isCurrent(): boolean;
}

/** An application's bounded binary delivery; protocol framing stays in the Interface. */
export type FileBinaryPiece = { kind: 'data'; bytes: Uint8Array } | { kind: 'end' };

export type FileBinaryEmit = (piece: FileBinaryPiece, signal: AbortSignal, remainingMs: () => number) => Promise<void>;

export type FileReadSelection =
	| { kind: 'all' }
	| { kind: 'suffix'; length: number }
	| { kind: 'range'; start: number; end?: number }
	| { kind: 'invalid' };

export class FileRangeNotSatisfiable extends Error {
	constructor(readonly fileSize: number) {
		super('Unsatisfiable byte range');
		this.name = 'FileRangeNotSatisfiable';
	}
}

export class FileDownloadTicketFailure extends Error {
	constructor(readonly reason: 'gone' | 'locked') {
		super('Download ticket ' + reason);
		this.name = 'FileDownloadTicketFailure';
	}
}

export interface FileDownloadTicketBinding {
	userId: number;
	sessionDigest: string;
	resourceId: string;
	connectionId: number;
	workspaceId: string;
	remotePath: string;
	fileSize: number;
	fileMtimeSeconds: number;
}

export interface FileDownloadTicketClaim {
	binding: FileDownloadTicketBinding;
	release(): void;
	complete(): void;
	invalidate(): void;
}

export type FileLineCommandOutcome = { status: 'completed' } | { status: 'nonzero'; exitCode: number };

export interface FileSnapshotNode {
	relativePath: string;
	kind: 'file' | 'directory';
	info: FileInfo;
	contentSha256: string | null;
}

export interface FileTreeSnapshot {
	path: string;
	kind: 'file' | 'directory';
	fingerprint: string;
	fileCount: number;
	directoryCount: number;
	bytes: number;
	nodes: FileSnapshotNode[];
}
