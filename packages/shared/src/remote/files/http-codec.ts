import {
	REMOTE_FILE_ERROR_CODES,
	REMOTE_FILE_MAX_LIST_ENTRIES,
	REMOTE_FILE_MAX_METADATA_BYTES,
	REMOTE_FILE_MAX_PATH_BYTES,
	REMOTE_FILE_MAX_RESPONSE_BYTES,
	REMOTE_FILE_MAX_TEXT_BYTES,
} from './values.js';
import type { RemoteFileEntry, RemoteFileInfo } from './model.js';
import type {
	RemoteFileCloseResponse,
	RemoteFileErrorResponse,
	RemoteFileListResponse,
	RemoteFileOpenRequest,
	RemoteFileOpenResponse,
	RemoteFilePathRequest,
	RemoteFileStatResponse,
	RemoteFileTextResponse,
} from './http.js';

export class InvalidRemoteFilePayload extends Error {
	constructor() {
		super('invalid_remote_file_payload');
	}
}

function record(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidRemoteFilePayload();
	}
	// Object shape is inspected before any field is used; do not return it as a business object.
	const row = input as Record<string, unknown>;
	if (Object.keys(row).some((key) => !allowed.includes(key)) ||
		required.some((key) => !Object.hasOwn(row, key))) {
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
	if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > maxBytes ||
		/[\uD800-\uDFFF]/u.test(input)) {
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

export function readRemoteFileOpenRequest(input: unknown): RemoteFileOpenRequest {
	const row = record(input, ['targetId']);
	return { targetId: integer(row.targetId, 1, Number.MAX_SAFE_INTEGER) };
}

export function readRemoteFilePathRequest(input: unknown): RemoteFilePathRequest {
	const row = record(input, ['path']);
	return { path: path(row.path) };
}

export function readRemoteFileInfo(input: unknown): RemoteFileInfo {
	const row = record(input, ['size', 'mode', 'modifiedAt', 'kind']);
	if (row.kind !== 'file' && row.kind !== 'directory' && row.kind !== 'symlink' && row.kind !== 'other') {
		throw new InvalidRemoteFilePayload();
	}
	return {
		size: integer(row.size, 0, Number.MAX_SAFE_INTEGER),
		mode: integer(row.mode, 0, 0xffff_ffff),
		modifiedAt: integer(row.modifiedAt, 0, Number.MAX_SAFE_INTEGER),
		kind: row.kind,
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
	if (encoder.encode(JSON.stringify(input)).byteLength > REMOTE_FILE_MAX_RESPONSE_BYTES ||
		encoder.encode(JSON.stringify(row.entries)).byteLength > REMOTE_FILE_MAX_METADATA_BYTES) {
		throw new InvalidRemoteFilePayload();
	}
	return { entries: row.entries.map(readRemoteFileEntry), complete: true };
}

export function readRemoteFileStatResponse(input: unknown): RemoteFileStatResponse {
	return { info: readRemoteFileInfo(record(input, ['info']).info) };
}

export function readRemoteFileTextResponse(input: unknown): RemoteFileTextResponse {
	const row = record(input, ['info', 'bytes', 'text']);
	const bytes = integer(row.bytes, 0, REMOTE_FILE_MAX_TEXT_BYTES);
	const text = string(row.text, REMOTE_FILE_MAX_TEXT_BYTES);
	if (new TextEncoder().encode(text).byteLength !== bytes ||
		new TextEncoder().encode(JSON.stringify(input)).byteLength > REMOTE_FILE_MAX_RESPONSE_BYTES) {
		throw new InvalidRemoteFilePayload();
	}
	return { info: readRemoteFileInfo(row.info), bytes, text };
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
