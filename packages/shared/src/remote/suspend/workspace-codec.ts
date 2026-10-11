import {
	WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES,
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

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return value as Record<string, unknown>;
}

function text(value: unknown): string {
	if (typeof value !== 'string' || !isWellFormedFileText(value)) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return value;
}

function id(value: unknown): string {
	const v = text(value);
	if (!/^[A-Za-z0-9_-]{8,128}$/u.test(v)) {
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
	const row = object(value);
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
	const row = object(value);
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
		const v = object(row.viewport);
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
	const row = object(value);
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
	const row = object(value);
	return { suspendedSessionId: id(row.suspendedSessionId) };
}

export function readWorkspaceSuspendRename(value: unknown): WorkspaceSuspendRenameRequest {
	const row = object(value);
	return { suspendedSessionId: id(row.suspendedSessionId), name: name(row.name) };
}

export function readWorkspaceSuspendHistory(value: unknown): WorkspaceSuspendHistoryPreviousRequest {
	const row = object(value);
	if (row.maxBytes === undefined) {
		return {};
	}
	const maxBytes = positive(row.maxBytes);
	if (maxBytes > WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES) {
		throw new InvalidWorkspaceSuspendPayload();
	}
	return { maxBytes };
}

export function readWorkspaceSuspendHttpRename(value: unknown): { customName: string } {
	return { customName: name(object(value).customName) };
}
