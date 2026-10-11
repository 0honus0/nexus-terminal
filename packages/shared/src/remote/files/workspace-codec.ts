import { isWellFormedFileText } from './text-codec.js';
import { WORKSPACE_FILES_MAX_BINARY_READ_BYTES } from './values.js';
import { WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES } from '../workspace/values.js';
import type {
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
