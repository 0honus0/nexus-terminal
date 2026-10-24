import type { QuickCommand, QuickCommandTag } from './model.js';
import type {
	QuickCommandCreateRequest,
	QuickCommandUpdateRequest,
	CommandVersionRequest,
	CommandTagCreateRequest,
	CommandTagUpdateRequest,
	CommandAssignTagRequest,
	CommandGroupDeleteRequest,
	CommandListQuery,
	CommandListResponse,
	CommandTagListResponse,
	CommandMutationResponse,
	CommandTagMutationResponse,
	CommandDeleteResponse,
	CommandAssignTagResponse,
	CommandErrorResponse,
} from './http.js';
import {
	COMMAND_SORTS,
	COMMAND_TEXT_MAX_BYTES,
	COMMAND_NAME_MAX_BYTES,
	COMMAND_MAX_TAGS,
	COMMAND_MAX_VARIABLES,
	COMMAND_VARIABLE_MAX_BYTES,
	COMMAND_BATCH_MAX_ENTRIES,
	COMMAND_MAX_ENTRIES,
	COMMAND_REQUEST_MAX_BYTES,
	COMMAND_RESPONSE_MAX_BYTES,
	COMMAND_PAGE_MAX_ENTRIES,
	COMMAND_ERROR_CODES,
} from './values.js';

export class InvalidCommandPayload extends Error {
	constructor() {
		super('Invalid command payload');
		this.name = 'InvalidCommandPayload';
	}
}

function object(input: unknown, keys?: readonly string[]): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidCommandPayload();
	}
	if (keys && (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key)))) {
		throw new InvalidCommandPayload();
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		Object.defineProperty(result, key, { value, enumerable: true });
	}
	return result;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new InvalidCommandPayload();
	}
	return value;
}

function text(value: unknown, max: number, nonempty = false): string {
	if (
		typeof value !== 'string' ||
		(nonempty && !value.trim()) ||
		value.includes('\0') ||
		new TextEncoder().encode(value).length > max ||
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value
	) {
		throw new InvalidCommandPayload();
	}
	return value;
}

function budget(value: unknown, max: number): void {
	const json = JSON.stringify(value);
	if (json === undefined || new TextEncoder().encode(json).length > max) {
		throw new InvalidCommandPayload();
	}
}

function variables(input: unknown): Record<string, string> {
	const value = object(input);
	if (Object.keys(value).length > COMMAND_MAX_VARIABLES) {
		throw new InvalidCommandPayload();
	}
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
			throw new InvalidCommandPayload();
		}
		Object.defineProperty(result, key, { value: text(entry, COMMAND_VARIABLE_MAX_BYTES), enumerable: true });
	}
	return result;
}

function tagIds(input: unknown): number[] {
	if (!Array.isArray(input) || input.length > COMMAND_MAX_TAGS) {
		throw new InvalidCommandPayload();
	}
	const ids = input.map((value: unknown) => integer(value, 1));
	if (new Set(ids).size !== ids.length) {
		throw new InvalidCommandPayload();
	}
	return ids;
}

export function readCommandCreate(input: unknown): QuickCommandCreateRequest {
	budget(input, COMMAND_REQUEST_MAX_BYTES);
	const value = object(input, ['name', 'command', 'variables', 'tagIds']);
	return {
		name: value.name === null ? null : text(value.name, COMMAND_NAME_MAX_BYTES),
		command: text(value.command, COMMAND_TEXT_MAX_BYTES, true),
		variables: variables(value.variables),
		tagIds: tagIds(value.tagIds),
	};
}

export function readCommandUpdate(input: unknown): QuickCommandUpdateRequest {
	budget(input, COMMAND_REQUEST_MAX_BYTES);
	const value = object(input, ['expectedVersion', 'name', 'command', 'variables', 'tagIds']);
	return {
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		name: value.name === null ? null : text(value.name, COMMAND_NAME_MAX_BYTES),
		command: text(value.command, COMMAND_TEXT_MAX_BYTES, true),
		variables: variables(value.variables),
		tagIds: tagIds(value.tagIds),
	};
}

export function readCommandVersion(input: unknown): CommandVersionRequest {
	budget(input, COMMAND_REQUEST_MAX_BYTES);
	const value = object(input, ['expectedVersion']);
	return { expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) };
}

export function readCommandTagCreate(input: unknown): CommandTagCreateRequest {
	budget(input, COMMAND_REQUEST_MAX_BYTES);
	const value = object(input, ['name']);
	return { name: text(value.name, COMMAND_NAME_MAX_BYTES, true) };
}

export function readCommandTagUpdate(input: unknown): CommandTagUpdateRequest {
	budget(input, COMMAND_REQUEST_MAX_BYTES);
	const value = object(input, ['name', 'expectedVersion']);
	return {
		name: text(value.name, COMMAND_NAME_MAX_BYTES, true),
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
	};
}

export function readCommandGroupDelete(input: unknown): CommandGroupDeleteRequest {
	budget(input, COMMAND_REQUEST_MAX_BYTES);
	const value = object(input, ['expectedVersion', 'commands']);
	if (!Array.isArray(value.commands) || value.commands.length > COMMAND_MAX_ENTRIES) {
		throw new InvalidCommandPayload();
	}
	const commands = value.commands.map((raw: unknown) => {
		const item = object(raw, ['id', 'expectedVersion']);
		return {
			id: integer(item.id, 1),
			expectedVersion: integer(item.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		};
	});
	if (new Set(commands.map((item) => item.id)).size !== commands.length) {
		throw new InvalidCommandPayload();
	}
	return { expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1), commands };
}

export function readCommandAssign(input: unknown): CommandAssignTagRequest {
	budget(input, COMMAND_REQUEST_MAX_BYTES);
	const value = object(input, ['commands', 'tagId']);
	if (!Array.isArray(value.commands) || !value.commands.length || value.commands.length > COMMAND_BATCH_MAX_ENTRIES) {
		throw new InvalidCommandPayload();
	}
	const commands = value.commands.map((raw: unknown) => {
		const item = object(raw, ['id', 'expectedVersion']);
		return {
			id: integer(item.id, 1),
			expectedVersion: integer(item.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		};
	});
	if (new Set(commands.map((item) => item.id)).size !== commands.length) {
		throw new InvalidCommandPayload();
	}
	return { commands, tagId: integer(value.tagId, 1) };
}

export function readCommandQuery(query: URLSearchParams, tags = false): CommandListQuery {
	const seen = new Set<string>();
	for (const [key, value] of query) {
		if (
			!['offset', 'limit', 'sortBy'].includes(key) ||
			seen.has(key) ||
			(key !== 'sortBy' && !/^(0|[1-9]\d*)$/.test(value)) ||
			(tags && key === 'sortBy')
		) {
			throw new InvalidCommandPayload();
		}
		seen.add(key);
	}
	const sortBy = COMMAND_SORTS.find((value) => value === (query.get('sortBy') ?? 'name'));
	if (!sortBy) {
		throw new InvalidCommandPayload();
	}
	return {
		sortBy,
		offset: integer(Number(query.get('offset') ?? '0'), 0, COMMAND_MAX_ENTRIES),
		limit: integer(Number(query.get('limit') ?? String(COMMAND_PAGE_MAX_ENTRIES)), 1, COMMAND_PAGE_MAX_ENTRIES),
	};
}

export function readCommandId(input: unknown): number {
	if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input)) {
		throw new InvalidCommandPayload();
	}
	return integer(Number(input), 1);
}

export function readQuickCommand(input: unknown): QuickCommand {
	const value = object(input, [
		'id',
		'version',
		'name',
		'command',
		'usageCount',
		'variables',
		'tagIds',
		'createdAt',
		'updatedAt',
	]);
	const createdAt = integer(value.createdAt, 0);
	return {
		id: integer(value.id, 1),
		version: integer(value.version, 1),
		name: value.name === null ? null : text(value.name, COMMAND_NAME_MAX_BYTES),
		command: text(value.command, COMMAND_TEXT_MAX_BYTES, true),
		usageCount: integer(value.usageCount, 0),
		variables: variables(value.variables),
		tagIds: tagIds(value.tagIds),
		createdAt,
		updatedAt: integer(value.updatedAt, createdAt),
	};
}

export function readQuickCommandTag(input: unknown): QuickCommandTag {
	const value = object(input, ['id', 'version', 'name', 'createdAt', 'updatedAt']);
	const createdAt = integer(value.createdAt, 0);
	return {
		id: integer(value.id, 1),
		version: integer(value.version, 1),
		name: text(value.name, COMMAND_NAME_MAX_BYTES, true),
		createdAt,
		updatedAt: integer(value.updatedAt, createdAt),
	};
}

function page(input: unknown, query: CommandListQuery): { rows: unknown[]; nextOffset: number | null } {
	budget(input, COMMAND_RESPONSE_MAX_BYTES);
	const value = object(input, ['entries', 'nextOffset']);
	if (
		!Array.isArray(value.entries) ||
		value.entries.length > query.limit ||
		value.entries.length > COMMAND_PAGE_MAX_ENTRIES
	) {
		throw new InvalidCommandPayload();
	}
	const nextOffset = value.nextOffset === null ? null : integer(value.nextOffset, 1, 2000);
	if (
		nextOffset !== null &&
		(value.entries.length !== query.limit || nextOffset !== query.offset + value.entries.length)
	) {
		throw new InvalidCommandPayload();
	}
	return { rows: value.entries, nextOffset };
}

export function readCommandList(input: unknown, query: CommandListQuery): CommandListResponse {
	const value = page(input, query);
	const entries = value.rows.map(readQuickCommand);
	if (new Set(entries.map((row) => row.id)).size !== entries.length) {
		throw new InvalidCommandPayload();
	}
	return { entries, nextOffset: value.nextOffset };
}

export function readCommandTagList(input: unknown, query: CommandListQuery): CommandTagListResponse {
	const value = page(input, query);
	const entries = value.rows.map(readQuickCommandTag);
	if (new Set(entries.map((row) => row.id)).size !== entries.length) {
		throw new InvalidCommandPayload();
	}
	return { entries, nextOffset: value.nextOffset };
}

export function readCommandMutation(input: unknown): CommandMutationResponse {
	budget(input, COMMAND_RESPONSE_MAX_BYTES);
	const value = object(input, ['command']);
	return { command: readQuickCommand(value.command) };
}

export function readCommandTagMutation(input: unknown): CommandTagMutationResponse {
	const value = object(input, ['tag']);
	return { tag: readQuickCommandTag(value.tag) };
}

export function readCommandDelete(input: unknown): CommandDeleteResponse {
	const value = object(input, ['deleted']);
	if (value.deleted !== true) {
		throw new InvalidCommandPayload();
	}
	return { deleted: true };
}

export function readCommandAssignResponse(input: unknown): CommandAssignTagResponse {
	const value = object(input, ['count']);
	return { count: integer(value.count, 0, 1000) };
}

export function readCommandError(input: unknown): CommandErrorResponse {
	const value = object(input, ['code']);
	const code = COMMAND_ERROR_CODES.find((candidate) => candidate === value.code);
	if (!code) {
		throw new InvalidCommandPayload();
	}
	return { code };
}
