import { REMOTE_FILE_MAX_PATH_BYTES } from '../files/values.js';
import {
	WORKSPACE_TERMINAL_MAX_COLUMNS,
	WORKSPACE_TERMINAL_MAX_INPUT_BYTES,
	WORKSPACE_TERMINAL_MAX_ROWS,
	WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES,
} from '../workspace/values.js';
import { WORKSPACE_DIRECTORY_CHANGE_FAILURE_CODES } from './values.js';
import { isWellFormedFileText } from '../files/text-codec.js';
import type {
	WorkspaceTerminalFlow,
	WorkspaceTerminalInput,
	WorkspaceTerminalResize,
	WorkspaceTerminalChangeDirectory,
	WorkspaceTerminalEvents,
} from './workspace.js';

export class InvalidWorkspaceTerminalPayload extends Error {
	constructor() {
		super('invalid_workspace_terminal_payload');
	}
}

function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some((key) => !Object.hasOwn(value, key))) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return value as Record<string, unknown>;
}

export function readWorkspaceTerminalInput(value: unknown): WorkspaceTerminalInput {
	const data = row(value, ['data']).data;
	if (
		typeof data !== 'string' ||
		!isWellFormedFileText(data) ||
		new TextEncoder().encode(data).length > WORKSPACE_TERMINAL_MAX_INPUT_BYTES
	) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return { data };
}

export function readWorkspaceTerminalFlow(value: unknown): WorkspaceTerminalFlow {
	const consumedBytes = row(value, ['consumedBytes']).consumedBytes;
	if (typeof consumedBytes !== 'number' || !Number.isSafeInteger(consumedBytes) || consumedBytes < 0) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return { consumedBytes };
}

export function readWorkspaceTerminalResize(value: unknown): WorkspaceTerminalResize {
	const input = row(value, ['columns', 'rows']);
	const { columns, rows } = input;
	if (
		typeof columns !== 'number' ||
		!Number.isSafeInteger(columns) ||
		columns < 2 ||
		columns > WORKSPACE_TERMINAL_MAX_COLUMNS ||
		typeof rows !== 'number' ||
		!Number.isSafeInteger(rows) ||
		rows < 1 ||
		rows > WORKSPACE_TERMINAL_MAX_ROWS
	) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return { columns, rows };
}

export function readWorkspaceTerminalChangeDirectory(value: unknown): WorkspaceTerminalChangeDirectory {
	const path = row(value, ['path']).path;
	if (
		typeof path !== 'string' ||
		!path ||
		!isWellFormedFileText(path) ||
		new TextEncoder().encode(path).length > REMOTE_FILE_MAX_PATH_BYTES
	) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return { path };
}

function requestId(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value ||
		!isWellFormedFileText(value) ||
		new TextEncoder().encode(value).length > WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES
	) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return value;
}

export function readWorkspaceTerminalCurrentDirectory(value: unknown): string {
	return readWorkspaceTerminalChangeDirectory({ path: value }).path;
}

export function readWorkspaceTerminalChangeDirectoryResponse(value: unknown): { queued: true } {
	if (row(value, ['queued']).queued !== true) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return { queued: true };
}

export function readWorkspaceTerminalClosed(value: unknown): WorkspaceTerminalEvents['terminal.closed'] {
	row(value, []);
	return {};
}

export function readWorkspaceTerminalError(value: unknown): WorkspaceTerminalEvents['terminal.error'] {
	if (row(value, ['message']).message !== 'remote_unavailable') {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return { message: 'remote_unavailable' };
}

export function readWorkspaceTerminalDirectoryQueued(
	value: unknown,
): WorkspaceTerminalEvents['terminal.directoryChangeQueued'] {
	const input = row(value, ['requestId', 'path', 'waitingForPrompt']);
	if (typeof input.waitingForPrompt !== 'boolean') {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return {
		requestId: requestId(input.requestId),
		path: readWorkspaceTerminalCurrentDirectory(input.path),
		waitingForPrompt: input.waitingForPrompt,
	};
}

export function readWorkspaceTerminalDirectoryChanged(
	value: unknown,
): WorkspaceTerminalEvents['terminal.directoryChanged'] {
	const input = row(value, ['requestId', 'path']);
	return { requestId: requestId(input.requestId), path: readWorkspaceTerminalCurrentDirectory(input.path) };
}

export function readWorkspaceTerminalDirectoryFailed(
	value: unknown,
): WorkspaceTerminalEvents['terminal.directoryChangeFailed'] {
	const input = row(value, ['requestId', 'message']);
	const message = WORKSPACE_DIRECTORY_CHANGE_FAILURE_CODES.find((code) => code === input.message);
	if (!message) {
		throw new InvalidWorkspaceTerminalPayload();
	}
	return { requestId: requestId(input.requestId), message };
}
