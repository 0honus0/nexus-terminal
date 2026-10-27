import {
	WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES,
	WORKSPACE_SUSPEND_MAX_JSON_BYTES,
	SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
	SUSPENDED_SESSION_ID_PATTERN,
	WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES,
	WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS,
} from './values.js';
import { isWellFormedFileText } from '../files/text-codec.js';
import { WORKSPACE_TERMINAL_MAX_COLUMNS, WORKSPACE_TERMINAL_MAX_ROWS } from '../workspace/values.js';
import type {
	WorkspaceSuspendMarkRequest,
	WorkspaceSuspendResumeRequest,
	WorkspaceSuspendResumeAck,
	WorkspaceSuspendHistoryPreviousRequest,
	WorkspaceSuspendSessionRequest,
	WorkspaceSuspendRenameRequest,
} from './workspace.js';

export class InvalidWorkspaceSuspendPayload extends Error {
	constructor() {
		super('invalid_workspace_suspend_payload');
		this.name = 'InvalidWorkspaceSuspendPayload';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(
	value: unknown,
	fields: readonly string[],
	maxBytes = SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key))) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	try {
		if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) {
			throw new InvalidWorkspaceSuspendPayload();
		}
	} catch (cause) {
		if (cause instanceof InvalidWorkspaceSuspendPayload) {
			throw cause;
		}
		throw new InvalidWorkspaceSuspendPayload();
	}
	return value;
}

function text(value: unknown): string {
	if (typeof value !== 'string' || !isWellFormedFileText(value)) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return value;
}

function id(value: unknown): string {
	const v = text(value);
	if (!SUSPENDED_SESSION_ID_PATTERN.test(v)) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return v;
}

function positive(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return value;
}

function name(value: unknown): string {
	const v = text(value).trim();
	if (v.length > WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS || /[\u0000-\u001f\u007f-\u009f]/u.test(v)) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return v;
}

export function readWorkspaceSuspendMark(value: unknown): WorkspaceSuspendMarkRequest {
	const row = object(value, ['terminalSnapshot'], WORKSPACE_SUSPEND_MAX_JSON_BYTES);
	if (row.terminalSnapshot === undefined) {
		return {};
	}
	const snapshot = text(row.terminalSnapshot);
	if (new TextEncoder().encode(snapshot).byteLength > WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return { terminalSnapshot: snapshot };
}

export function readWorkspaceSuspendResume(value: unknown): WorkspaceSuspendResumeRequest {
	const row = object(value, ['suspendedSessionId', 'workspaceId', 'viewport', 'takeover']);
	const result: WorkspaceSuspendResumeRequest = {
		suspendedSessionId: id(row.suspendedSessionId),
		workspaceId: id(row.workspaceId),
	};
	if (row.takeover !== undefined) {
		if (typeof row.takeover !== 'boolean') {
			throw new InvalidWorkspaceSuspendPayload();
		}
		result.takeover = row.takeover;
	}
	if (row.viewport !== undefined) {
		const v = object(row.viewport, ['columns', 'rows']);
		const columns = positive(v.columns),
			rows = positive(v.rows);
		if (columns < 2 || columns > WORKSPACE_TERMINAL_MAX_COLUMNS || rows > WORKSPACE_TERMINAL_MAX_ROWS) {
			throw new InvalidWorkspaceSuspendPayload();
		}
		result.viewport = { columns, rows };
	}
	return result;
}

export function readWorkspaceSuspendAck(value: unknown): WorkspaceSuspendResumeAck {
	const row = object(value, ['suspendedSessionId', 'resumeToken', 'attachmentGeneration', 'ownershipGeneration']);
	const resumeToken = text(row.resumeToken);
	if (!resumeToken || resumeToken.length > 256) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return {
		suspendedSessionId: id(row.suspendedSessionId),
		resumeToken,
		attachmentGeneration: positive(row.attachmentGeneration),
		ownershipGeneration: positive(row.ownershipGeneration),
	};
}

export function readWorkspaceSuspendSession(value: unknown): WorkspaceSuspendSessionRequest {
	const row = object(value, ['suspendedSessionId']);
	return { suspendedSessionId: id(row.suspendedSessionId) };
}

export function readWorkspaceSuspendRename(value: unknown): WorkspaceSuspendRenameRequest {
	const row = object(value, ['suspendedSessionId', 'name']);
	return { suspendedSessionId: id(row.suspendedSessionId), name: name(row.name) };
}

export function readWorkspaceSuspendHistory(value: unknown): WorkspaceSuspendHistoryPreviousRequest {
	const row = object(value, ['maxBytes']);
	if (row.maxBytes === undefined) {
		return {};
	}
	const maxBytes = positive(row.maxBytes);
	if (maxBytes > WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return { maxBytes };
}

export function readWorkspaceSuspendEmpty(value: unknown): Record<string, never> {
	object(value, []);
	return {};
}
