import { isWellFormedFileText } from '../files/text-codec.js';
import {
	WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES,
	WORKSPACE_TERMINAL_MAX_COLUMNS,
	WORKSPACE_TERMINAL_MAX_ROWS,
} from './values.js';
import type {
	WorkspaceCloseRequest,
	WorkspaceConnectRequest,
	WorkspaceProtocolRequest,
	WorkspaceResumeAck,
	WorkspaceResumeRequest,
	WorkspaceTerminalViewport,
} from './workspace.js';

export class InvalidWorkspacePayload extends Error {
	constructor() {
		super('invalid_workspace_payload');
		this.name = 'InvalidWorkspacePayload';
	}
}

function object(input: unknown, required: readonly string[]): Record<string, unknown> {
	if (
		input === null ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		required.some((key) => !Object.hasOwn(input, key))
	) {
		throw new InvalidWorkspacePayload();
	}
	return input as Record<string, unknown>;
}

function text(input: unknown): string {
	if (typeof input !== 'string' || !isWellFormedFileText(input)) {
		throw new InvalidWorkspacePayload();
	}
	return input;
}

function integer(input: unknown): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) {
		throw new InvalidWorkspacePayload();
	}
	return input;
}

function workspaceId(input: unknown): string {
	const value = text(input);
	if (!/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
		throw new InvalidWorkspacePayload();
	}
	return value;
}

function credential(input: unknown): string {
	const value = text(input);
	if (!value || value.length > 256) {
		throw new InvalidWorkspacePayload();
	}
	return value;
}

function viewport(input: unknown): WorkspaceTerminalViewport {
	const row = object(input, ['columns', 'rows']);
	const columns = integer(row.columns);
	const rows = integer(row.rows);
	if (columns < 2 || columns > WORKSPACE_TERMINAL_MAX_COLUMNS || rows > WORKSPACE_TERMINAL_MAX_ROWS) {
		throw new InvalidWorkspacePayload();
	}
	return { columns, rows };
}

/** Preserve the legacy envelope's extra-field tolerance, projecting known fields only. */
export function readWorkspaceRequest(input: unknown): WorkspaceProtocolRequest {
	const row = object(input, ['type']);
	const type = text(row.type);
	if (!type || type.length > 128) {
		throw new InvalidWorkspacePayload();
	}
	const result: WorkspaceProtocolRequest = { type };
	if (row.requestId !== undefined) {
		const id = text(row.requestId);
		if (!id || new TextEncoder().encode(id).byteLength > WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES) {
			throw new InvalidWorkspacePayload();
		}
		result.requestId = id;
	}
	if (row.payload !== undefined) {
		result.payload = object(row.payload, []);
	}
	return result;
}

export function readWorkspaceConnectRequest(input: unknown): WorkspaceConnectRequest {
	const row = object(input, ['workspaceId', 'connectionId']);
	const result: WorkspaceConnectRequest = {
		workspaceId: workspaceId(row.workspaceId),
		connectionId: integer(row.connectionId),
	};
	if (row.viewport !== undefined) {
		result.viewport = viewport(row.viewport);
	}
	return result;
}

export function readWorkspaceResumeRequest(input: unknown): WorkspaceResumeRequest {
	const row = object(input, ['workspaceId', 'connectionId', 'resumeToken', 'attachmentGeneration', 'terminalOffset']);
	if (typeof row.terminalOffset !== 'number' || !Number.isSafeInteger(row.terminalOffset) || row.terminalOffset < 0) {
		throw new InvalidWorkspacePayload();
	}
	const result: WorkspaceResumeRequest = {
		workspaceId: workspaceId(row.workspaceId),
		connectionId: integer(row.connectionId),
		resumeToken: credential(row.resumeToken),
		attachmentGeneration: integer(row.attachmentGeneration),
		terminalOffset: row.terminalOffset,
	};
	if (row.viewport !== undefined) {
		result.viewport = viewport(row.viewport);
	}
	return result;
}

export function readWorkspaceCloseRequest(input: unknown): WorkspaceCloseRequest {
	const row = object(input, ['workspaceId', 'connectionId', 'resumeToken', 'attachmentGeneration']);
	return {
		workspaceId: workspaceId(row.workspaceId),
		connectionId: integer(row.connectionId),
		resumeToken: credential(row.resumeToken),
		attachmentGeneration: integer(row.attachmentGeneration),
	};
}

export function readWorkspaceResumeAck(input: unknown): WorkspaceResumeAck {
	const row = object(input, ['resumeToken', 'attachmentGeneration']);
	return { resumeToken: credential(row.resumeToken), attachmentGeneration: integer(row.attachmentGeneration) };
}
