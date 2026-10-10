import {
	REMOTE_TERMINAL_MAX_COLUMNS,
	REMOTE_TERMINAL_MAX_ROWS,
	REMOTE_TERMINAL_MAX_TERM_LENGTH,
	type RemoteHttpErrorCode,
} from './values.js';
import { isRemoteSessionId, type RemoteShellView } from './model.js';

export interface RemoteOpenShell {
	targetId: number;
	columns: number;
	rows: number;
	term?: string;
}

export class InvalidRemotePayload extends Error {
	constructor() {
		super('invalid_remote_payload');
	}
}

function remoteObject(value: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new InvalidRemotePayload();
	}
	const row = value as Record<string, unknown>;
	if (
		Object.keys(row).some((field) => !allowed.includes(field)) ||
		required.some((field) => !Object.hasOwn(row, field))
	) {
		throw new InvalidRemotePayload();
	}
	return row;
}

function positiveRemoteNumber(value: unknown, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new InvalidRemotePayload();
	}
	return value;
}

export function readRemoteOpenShell(value: unknown): RemoteOpenShell {
	const row = remoteObject(value, ['targetId', 'columns', 'rows', 'term'], ['targetId', 'columns', 'rows']);
	if (
		row.term !== undefined &&
		(typeof row.term !== 'string' ||
			row.term.length > REMOTE_TERMINAL_MAX_TERM_LENGTH ||
			!/^[-\w.]+$/u.test(row.term))
	) {
		throw new InvalidRemotePayload();
	}
	return {
		targetId: positiveRemoteNumber(row.targetId, Number.MAX_SAFE_INTEGER),
		columns: positiveRemoteNumber(row.columns, REMOTE_TERMINAL_MAX_COLUMNS),
		rows: positiveRemoteNumber(row.rows, REMOTE_TERMINAL_MAX_ROWS),
		...(row.term === undefined ? {} : { term: row.term }),
	};
}

export function readRemoteShellView(value: unknown): RemoteShellView {
	const row = remoteObject(value, ['id', 'targetId', 'configurationFingerprint', 'startedAt', 'status']);
	if (
		!isRemoteSessionId(row.id) ||
		typeof row.configurationFingerprint !== 'string' ||
		row.configurationFingerprint.length < 1 ||
		row.configurationFingerprint.length > 256 ||
		typeof row.startedAt !== 'number' ||
		!Number.isSafeInteger(row.startedAt) ||
		row.startedAt < 0 ||
		row.status !== 'open'
	) {
		throw new InvalidRemotePayload();
	}
	return {
		id: row.id,
		targetId: positiveRemoteNumber(row.targetId, Number.MAX_SAFE_INTEGER),
		configurationFingerprint: row.configurationFingerprint,
		startedAt: row.startedAt,
		status: 'open',
	};
}

export interface RemoteFailureResponse {
	code: RemoteHttpErrorCode;
}

export function readRemoteFailureResponse(value: unknown): RemoteFailureResponse {
	const row = remoteObject(value, ['code']);
	switch (row.code) {
		case 'unauthenticated':
		case 'forbidden':
		case 'invalid_input':
		case 'not_found':
		case 'host_key_untrusted':
		case 'remote_unavailable':
			return { code: row.code };
		default:
			throw new InvalidRemotePayload();
	}
}

export interface RemoteCloseSessionResponse {
	closed: true;
}

export function readRemoteCloseSession(value: unknown): RemoteCloseSessionResponse {
	const row = remoteObject(value, ['closed']);
	if (row.closed !== true) {
		throw new InvalidRemotePayload();
	}
	return { closed: true };
}
