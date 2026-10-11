import { isWellFormedFileText } from './text-codec.js';
import {
	REMOTE_FILE_ERROR_CODES,
	REMOTE_FILE_MAX_LIST_ENTRIES,
	REMOTE_FILE_MAX_METADATA_BYTES,
	REMOTE_FILE_MAX_PATH_BYTES,
	REMOTE_FILE_MAX_RESPONSE_BYTES,
	REMOTE_FILE_MAX_TEXT_BYTES,
	REMOTE_FILE_MAX_WRITE_REQUEST_BYTES,
	type RemoteFileKind,
} from './values.js';
import type { RemoteFileEntry, RemoteFileInfo } from './model.js';
import type {
	RemoteFileCloseResponse,
	RemoteFileCreateDirectoryResponse,
	RemoteFileErrorResponse,
	RemoteFileListResponse,
	RemoteFileOpenRequest,
	RemoteFileOpenResponse,
	RemoteFilePathRequest,
	RemoteFileRemoveDirectoryResponse,
	RemoteFileRemoveResponse,
	RemoteFileRenameRequest,
	RemoteFileRenameResponse,
	RemoteFileStatResponse,
	RemoteFileTextResponse,
	RemoteFileWriteTextRequest,
	RemoteFileWriteTextResponse,
} from './http.js';

export class InvalidRemoteFilePayload extends Error {
	constructor() {
		super('invalid_remote_file_payload');
	}
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function record(
	input: unknown,
	allowed: readonly string[],
	required: readonly string[] = allowed,
): Record<string, unknown> {
	if (!isRecord(input)) {
		throw new InvalidRemoteFilePayload();
	}
	const row = input;
	if (Object.keys(row).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(row, key))) {
		throw new InvalidRemoteFilePayload();
	}
	return row;
}

function integer(input: unknown, min: number, max: number): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
		throw new InvalidRemoteFilePayload();
	}
	return input;
}

function string(input: unknown, maxBytes: number): string {
	if (
		typeof input !== 'string' ||
		new TextEncoder().encode(input).byteLength > maxBytes ||
		!isWellFormedFileText(input)
	) {
		throw new InvalidRemoteFilePayload();
	}
	return input;
}

function identifier(input: unknown): string {
	const value = string(input, 64);
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
		throw new InvalidRemoteFilePayload();
	}
	return value;
}

function path(input: unknown): string {
	const value = string(input, REMOTE_FILE_MAX_PATH_BYTES);
	if (!value.startsWith('/') || /[\u0000-\u001f\u007f\ufffd]/u.test(value)) {
		throw new InvalidRemoteFilePayload();
	}
	return value;
}

function sha256(input: unknown): string {
	const value = string(input, 64);
	if (!/^[a-f0-9]{64}$/u.test(value)) {
		throw new InvalidRemoteFilePayload();
	}
	return value;
}

function kind(input: unknown): RemoteFileKind {
	if (input !== 'file' && input !== 'directory' && input !== 'symlink' && input !== 'other') {
		throw new InvalidRemoteFilePayload();
	}
	return input;
}

function encodedBytes(input: unknown): number {
	return new TextEncoder().encode(JSON.stringify(input)).byteLength;
}

export function readRemoteFileOpenRequest(input: unknown): RemoteFileOpenRequest {
	const row = record(input, ['targetId']);
	return { targetId: integer(row.targetId, 1, Number.MAX_SAFE_INTEGER) };
}

export function readRemoteFilePathRequest(input: unknown): RemoteFilePathRequest {
	const row = record(input, ['path']);
	return { path: path(row.path) };
}

export function readRemoteFileWriteTextRequest(input: unknown): RemoteFileWriteTextRequest {
	const row = record(input, ['path', 'text', 'expectedSha256']);
	const text = string(row.text, REMOTE_FILE_MAX_TEXT_BYTES);
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
		throw new InvalidRemoteFilePayload();
	}
	const result: RemoteFileWriteTextRequest = {
		path: path(row.path),
		text,
		expectedSha256: row.expectedSha256 === null ? null : sha256(row.expectedSha256),
	};
	if (encodedBytes(input) > REMOTE_FILE_MAX_WRITE_REQUEST_BYTES) {
		throw new InvalidRemoteFilePayload();
	}
	return result;
}

export function readRemoteFileRenameRequest(input: unknown): RemoteFileRenameRequest {
	const row = record(input, ['from', 'to']);
	return { from: path(row.from), to: path(row.to) };
}

export function readRemoteFileInfo(input: unknown): RemoteFileInfo {
	const row = record(input, ['size', 'mode', 'modifiedAt', 'kind']);
	return {
		size: integer(row.size, 0, Number.MAX_SAFE_INTEGER),
		mode: integer(row.mode, 0, 0xffff_ffff),
		modifiedAt: integer(row.modifiedAt, 0, Number.MAX_SAFE_INTEGER),
		kind: kind(row.kind),
	};
}

export function readRemoteFileEntry(input: unknown): RemoteFileEntry {
	const row = record(input, ['name', 'info']);
	const name = string(row.name, 255);
	if (!name || name === '.' || name === '..' || /[\/\u0000-\u001f\u007f\ufffd]/u.test(name)) {
		throw new InvalidRemoteFilePayload();
	}
	return { name, info: readRemoteFileInfo(row.info) };
}

export function readRemoteFileOpenResponse(input: unknown): RemoteFileOpenResponse {
	const row = record(input, ['id', 'targetId', 'configurationFingerprint']);
	const configurationFingerprint = string(row.configurationFingerprint, 64);
	if (!/^[a-f0-9]{64}$/u.test(configurationFingerprint)) {
		throw new InvalidRemoteFilePayload();
	}
	return {
		id: identifier(row.id),
		targetId: integer(row.targetId, 1, Number.MAX_SAFE_INTEGER),
		configurationFingerprint,
	};
}

export function readRemoteFileListResponse(input: unknown): RemoteFileListResponse {
	const row = record(input, ['entries', 'complete']);
	if (row.complete !== true || !Array.isArray(row.entries) || row.entries.length > REMOTE_FILE_MAX_LIST_ENTRIES) {
		throw new InvalidRemoteFilePayload();
	}
	const encoder = new TextEncoder();
	if (
		encodedBytes(input) > REMOTE_FILE_MAX_RESPONSE_BYTES ||
		encoder.encode(JSON.stringify(row.entries)).byteLength > REMOTE_FILE_MAX_METADATA_BYTES
	) {
		throw new InvalidRemoteFilePayload();
	}
	return { entries: row.entries.map(readRemoteFileEntry), complete: true };
}

export function readRemoteFileStatResponse(input: unknown): RemoteFileStatResponse {
	return { info: readRemoteFileInfo(record(input, ['info']).info) };
}

export function readRemoteFileTextResponse(input: unknown): RemoteFileTextResponse {
	const row = record(input, ['info', 'bytes', 'sha256', 'text']);
	const bytes = integer(row.bytes, 0, REMOTE_FILE_MAX_TEXT_BYTES);
	const text = string(row.text, REMOTE_FILE_MAX_TEXT_BYTES);
	if (new TextEncoder().encode(text).byteLength !== bytes || encodedBytes(input) > REMOTE_FILE_MAX_RESPONSE_BYTES) {
		throw new InvalidRemoteFilePayload();
	}
	return { info: readRemoteFileInfo(row.info), bytes, sha256: sha256(row.sha256), text };
}

export function readRemoteFileWriteTextResponse(input: unknown): RemoteFileWriteTextResponse {
	const row = record(input, ['status', 'info', 'bytes', 'sha256']);
	if (row.status !== 'created' && row.status !== 'replaced') {
		throw new InvalidRemoteFilePayload();
	}
	const info = readRemoteFileInfo(row.info);
	const bytes = integer(row.bytes, 0, REMOTE_FILE_MAX_TEXT_BYTES);
	if (info.kind !== 'file' || info.size !== bytes) {
		throw new InvalidRemoteFilePayload();
	}
	return {
		status: row.status,
		info,
		bytes,
		sha256: sha256(row.sha256),
	};
}

export function readRemoteFileRenameResponse(input: unknown): RemoteFileRenameResponse {
	const row = record(input, ['from', 'to', 'kind']);
	const entryKind = kind(row.kind);
	if (entryKind === 'other') {
		throw new InvalidRemoteFilePayload();
	}
	return { from: path(row.from), to: path(row.to), kind: entryKind };
}

export function readRemoteFileRemoveResponse(input: unknown): RemoteFileRemoveResponse {
	const row = record(input, ['path', 'kind', 'removed']);
	if (row.removed !== true || (row.kind !== 'file' && row.kind !== 'symlink')) {
		throw new InvalidRemoteFilePayload();
	}
	return { path: path(row.path), kind: row.kind, removed: true };
}

export function readRemoteFileCreateDirectoryResponse(input: unknown): RemoteFileCreateDirectoryResponse {
	const row = record(input, ['path', 'created']);
	if (row.created !== true) {
		throw new InvalidRemoteFilePayload();
	}
	return { path: path(row.path), created: true };
}

export function readRemoteFileRemoveDirectoryResponse(input: unknown): RemoteFileRemoveDirectoryResponse {
	const row = record(input, ['path', 'removed']);
	if (row.removed !== true) {
		throw new InvalidRemoteFilePayload();
	}
	return { path: path(row.path), removed: true };
}

export function readRemoteFileCloseResponse(input: unknown): RemoteFileCloseResponse {
	if (record(input, ['closed']).closed !== true) {
		throw new InvalidRemoteFilePayload();
	}
	return { closed: true };
}

export function readRemoteFileErrorResponse(input: unknown): RemoteFileErrorResponse {
	const code = record(input, ['code']).code;
	for (const item of REMOTE_FILE_ERROR_CODES) {
		if (item === code) {
			return { code: item };
		}
	}
	throw new InvalidRemoteFilePayload();
}
