import { REMOTE_FILE_MAX_PATH_BYTES } from '../files/values.js';
import {
	WORKSPACE_TERMINAL_MAX_COLUMNS,
	WORKSPACE_TERMINAL_MAX_INPUT_BYTES,
	WORKSPACE_TERMINAL_MAX_ROWS,
} from '../workspace/values.js';
import { isWellFormedFileText } from '../files/text-codec.js';
import type {
	WorkspaceTerminalFlow,
	WorkspaceTerminalInput,
	WorkspaceTerminalResize,
	WorkspaceTerminalChangeDirectory,
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
