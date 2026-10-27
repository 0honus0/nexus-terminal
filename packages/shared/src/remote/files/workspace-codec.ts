import { isWellFormedFileText } from './text-codec.js';
import { WORKSPACE_FILES_MAX_BINARY_READ_BYTES, WORKSPACE_FILES_MAX_SEARCH_ENTRIES } from './values.js';
import { WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES, WORKSPACE_ERROR_CODES } from '../workspace/values.js';
import type {
	WorkspaceFileMetadata,
	WorkspaceFileEntry,
	WorkspaceFileSearchEntry,
	WorkspaceFileListResponse,
	WorkspaceFileSearchResponse,
	WorkspaceFileReadBinaryResponse,
	WorkspaceFileRealpathResponse,
	WorkspaceFileErrorEvent,
	WorkspaceFileCancelReadRequest,
	WorkspaceFileChmodRequest,
	WorkspaceFileCreateFileRequest,
	WorkspaceFilePathRequest,
	WorkspaceFileReadBinaryRequest,
	WorkspaceFileRemoveRequest,
	WorkspaceFileRenameRequest,
	WorkspaceFileSearchRequest,
	WorkspaceFileWriteTextRequest,
} from './workspace.js';

export class InvalidWorkspaceFilesPayload extends Error {
	constructor() {
		super('invalid_workspace_files_payload');
	}
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

/** The Workspace contract ignores extra fields and projects only known fields. */
function record(input: unknown, required: readonly string[]): Record<string, unknown> {
	if (!isRecord(input) || required.some((key) => !Object.hasOwn(input, key))) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return input;
}

function text(input: unknown): string {
	if (typeof input !== 'string' || !isWellFormedFileText(input)) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return input;
}

function requestId(input: unknown): string {
	const value = text(input);
	if (!value || new TextEncoder().encode(value).length > WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return value;
}

function number(input: unknown): number {
	if (typeof input !== 'number' || !Number.isFinite(input)) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return input;
}

function positiveSafeInteger(input: unknown): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return input;
}

function stringArray(input: unknown): string[] {
	if (!Array.isArray(input) || input.some((value) => typeof value !== 'string')) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return input.map((value) => text(value));
}

export function readWorkspaceFilePathRequest(input: unknown): WorkspaceFilePathRequest {
	const row = record(input, ['path']);
	return { path: text(row.path) };
}

export function readWorkspaceFileSearchRequest(input: unknown): WorkspaceFileSearchRequest {
	const row = record(input, ['path', 'query']);
	return { path: text(row.path), query: text(row.query) };
}

export function readWorkspaceFileReadBinaryRequest(input: unknown): WorkspaceFileReadBinaryRequest {
	const row = record(input, ['path', 'maxBytes']);
	const maxBytes = positiveSafeInteger(row.maxBytes);
	if (maxBytes > WORKSPACE_FILES_MAX_BINARY_READ_BYTES) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return { path: text(row.path), maxBytes };
}

export function readWorkspaceFileCancelReadRequest(input: unknown): WorkspaceFileCancelReadRequest {
	const row = record(input, ['requestId']);
	return { requestId: requestId(row.requestId) };
}

export function readWorkspaceFileWriteTextRequest(input: unknown): WorkspaceFileWriteTextRequest {
	const row = record(input, ['path', 'content']);
	const result: WorkspaceFileWriteTextRequest = { path: text(row.path), content: text(row.content) };
	if (row.encoding !== undefined) {
		result.encoding = text(row.encoding);
	}
	return result;
}

export function readWorkspaceFileCreateFileRequest(input: unknown): WorkspaceFileCreateFileRequest {
	const row = record(input, ['path']);
	const result: WorkspaceFileCreateFileRequest = { path: text(row.path) };
	if (row.content !== undefined) {
		result.content = text(row.content);
	}
	if (row.encoding !== undefined) {
		result.encoding = text(row.encoding);
	}
	return result;
}

export function readWorkspaceFileRemoveRequest(input: unknown): WorkspaceFileRemoveRequest {
	const row = record(input, ['paths']);
	const result: WorkspaceFileRemoveRequest = { paths: stringArray(row.paths) };
	if (row.forceDirectoryPaths !== undefined) {
		const forced = stringArray(row.forceDirectoryPaths);
		if (forced.length > 0) {
			result.forceDirectoryPaths = forced;
		}
	}
	return result;
}

export function readWorkspaceFileRenameRequest(input: unknown): WorkspaceFileRenameRequest {
	const row = record(input, ['from', 'to']);
	return { from: text(row.from), to: text(row.to) };
}

export function readWorkspaceFileChmodRequest(input: unknown): WorkspaceFileChmodRequest {
	const row = record(input, ['path', 'mode']);
	const mode = number(row.mode);
	if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return { path: text(row.path), mode };
}

function nonnegativeInteger(input: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > maximum) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return input;
}

function boolean(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidWorkspaceFilesPayload();
	}
	return input;
}

function absolutePath(input: unknown): string {
	const value = text(input);
	if (!value.startsWith('/') || value.includes('\0')) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return value;
}

export function readWorkspaceFileMetadata(input: unknown): WorkspaceFileMetadata {
	const row = record(input, [
		'size',
		'uid',
		'gid',
		'mode',
		'accessedAt',
		'modifiedAt',
		'isFile',
		'isDirectory',
		'isSymbolicLink',
	]);
	const isFile = boolean(row.isFile);
	const isDirectory = boolean(row.isDirectory);
	const isSymbolicLink = boolean(row.isSymbolicLink);
	if (Number(isFile) + Number(isDirectory) + Number(isSymbolicLink) > 1) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return {
		size: nonnegativeInteger(row.size),
		uid: nonnegativeInteger(row.uid),
		gid: nonnegativeInteger(row.gid),
		mode: nonnegativeInteger(row.mode, 0xffff_ffff),
		accessedAt: nonnegativeInteger(row.accessedAt),
		modifiedAt: nonnegativeInteger(row.modifiedAt),
		isFile,
		isDirectory,
		isSymbolicLink,
	};
}

export function readWorkspaceFileEntry(input: unknown): WorkspaceFileEntry {
	const row = record(input, ['name', 'path', 'metadata']);
	const name = text(row.name);
	if ((!name && row.path !== '/') || name.includes('/') || name.includes('\0')) {
		throw new InvalidWorkspaceFilesPayload();
	}
	const result: WorkspaceFileEntry = {
		name,
		path: absolutePath(row.path),
		metadata: readWorkspaceFileMetadata(row.metadata),
	};
	if (row.longName !== undefined) {
		result.longName = text(row.longName);
	}
	return result;
}

export function readWorkspaceFileListResponse(input: unknown): WorkspaceFileListResponse {
	const row = record(input, ['path', 'entries']);
	if (!Array.isArray(row.entries)) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return { path: absolutePath(row.path), entries: row.entries.map(readWorkspaceFileEntry) };
}

function searchEntry(input: unknown): WorkspaceFileSearchEntry {
	const row = record(input, ['relativePath']);
	const entry = readWorkspaceFileEntry(input);
	const relativePath = text(row.relativePath);
	if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\0')) {
		throw new InvalidWorkspaceFilesPayload();
	}
	const result: WorkspaceFileSearchEntry = {
		name: entry.name,
		path: entry.path,
		metadata: entry.metadata,
		relativePath,
	};
	if (entry.longName !== undefined) {
		result.longName = entry.longName;
	}
	return result;
}

export function readWorkspaceFileSearchResponse(input: unknown): WorkspaceFileSearchResponse {
	const row = record(input, ['entries', 'truncated']);
	if (!Array.isArray(row.entries) || row.entries.length > WORKSPACE_FILES_MAX_SEARCH_ENTRIES) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return { entries: row.entries.map(searchEntry), truncated: boolean(row.truncated) };
}

export function readWorkspaceFileReadBinaryResponse(input: unknown): WorkspaceFileReadBinaryResponse {
	return { path: absolutePath(record(input, ['path']).path) };
}

export function readWorkspaceFileRealpathResponse(input: unknown): WorkspaceFileRealpathResponse {
	const row = record(input, ['requestedPath', 'absolutePath', 'targetType']);
	if (row.targetType !== 'file' && row.targetType !== 'directory' && row.targetType !== 'other') {
		throw new InvalidWorkspaceFilesPayload();
	}
	return {
		requestedPath: absolutePath(row.requestedPath),
		absolutePath: absolutePath(row.absolutePath),
		targetType: row.targetType,
	};
}

export function readWorkspaceFileMutationResponse(input: unknown): null {
	if (input !== null) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return null;
}

export function readWorkspaceFileCancelReadResponse(input: unknown): boolean {
	return boolean(input);
}

export function readWorkspaceFileReady(input: unknown): Record<string, never> {
	record(input, []);
	return {};
}

export function readWorkspaceFileError(input: unknown): WorkspaceFileErrorEvent {
	const row = record(input, ['message']);
	const message = WORKSPACE_ERROR_CODES.find((code) => code === row.message);
	if (!message) {
		throw new InvalidWorkspaceFilesPayload();
	}
	return { message };
}
