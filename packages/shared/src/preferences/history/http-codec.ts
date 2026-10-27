import type {
	CommandHistoryAddRequest,
	PathHistoryAddRequest,
	HistoryListQuery,
	CommandHistoryListResponse,
	PathHistoryListResponse,
	HistoryAddResponse,
	HistoryDeleteResponse,
	HistoryClearResponse,
	HistoryErrorResponse,
} from './http.js';
import {
	HISTORY_ERROR_CODES,
	HISTORY_TEXT_MAX_BYTES,
	HISTORY_REQUEST_MAX_BYTES,
	HISTORY_RESPONSE_MAX_BYTES,
	HISTORY_PAGE_MAX_ENTRIES,
} from './values.js';

export class InvalidHistoryPayload extends Error {
	constructor() {
		super('Invalid history payload');
		this.name = 'InvalidHistoryPayload';
	}
}

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidHistoryPayload();
	}
	if (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))) {
		throw new InvalidHistoryPayload();
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		result[key] = value;
	}
	return result;
}

function bounded(input: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
		throw new InvalidHistoryPayload();
	}
	return input;
}

export function readHistoryText(input: unknown): string {
	if (
		typeof input !== 'string' ||
		!input.trim() ||
		input.includes('\0') ||
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(input)) !== input ||
		new TextEncoder().encode(input).length > HISTORY_TEXT_MAX_BYTES
	) {
		throw new InvalidHistoryPayload();
	}
	return input;
}

function budget(input: unknown, max: number): void {
	const json = JSON.stringify(input);
	if (json === undefined || new TextEncoder().encode(json).length > max) {
		throw new InvalidHistoryPayload();
	}
}

export function readCommandHistoryAdd(input: unknown): CommandHistoryAddRequest {
	budget(input, HISTORY_REQUEST_MAX_BYTES);
	const value = object(input, ['command']);
	return { command: readHistoryText(value.command) };
}

export function readPathHistoryAdd(input: unknown): PathHistoryAddRequest {
	budget(input, HISTORY_REQUEST_MAX_BYTES);
	const value = object(input, ['path']);
	return { path: readHistoryText(value.path) };
}

export function readHistoryListQuery(query: URLSearchParams): HistoryListQuery {
	const seen = new Set<string>();
	for (const [key, value] of query) {
		if (!['offset', 'limit'].includes(key) || seen.has(key) || !/^(0|[1-9]\d*)$/.test(value)) {
			throw new InvalidHistoryPayload();
		}
		seen.add(key);
	}
	return {
		offset: bounded(Number(query.get('offset') ?? '0'), 0, 10000),
		limit: bounded(Number(query.get('limit') ?? String(HISTORY_PAGE_MAX_ENTRIES)), 1, HISTORY_PAGE_MAX_ENTRIES),
	};
}

export function readHistoryId(input: unknown): number {
	if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input)) {
		throw new InvalidHistoryPayload();
	}
	return bounded(Number(input), 1);
}

function entries(input: unknown, field: 'command' | 'path'): Array<{ id: number; text: string; timestamp: number }> {
	if (!Array.isArray(input) || input.length > HISTORY_PAGE_MAX_ENTRIES) {
		throw new InvalidHistoryPayload();
	}
	const ids = new Set<number>();
	return input.map((raw: unknown) => {
		const value = object(raw, ['id', field, 'timestamp']);
		const id = bounded(value.id, 1);
		if (ids.has(id)) {
			throw new InvalidHistoryPayload();
		}
		ids.add(id);
		return { id, text: readHistoryText(value[field]), timestamp: bounded(value.timestamp, 0) };
	});
}

function page(input: unknown, field: 'command' | 'path', query: HistoryListQuery) {
	budget(input, HISTORY_RESPONSE_MAX_BYTES);
	const value = object(input, ['entries', 'nextOffset']);
	const rows = entries(value.entries, field);
	if (rows.length > query.limit) {
		throw new InvalidHistoryPayload();
	}
	const nextOffset = value.nextOffset === null ? null : bounded(value.nextOffset, 1, 10000);
	if (nextOffset !== null && (rows.length !== query.limit || nextOffset !== query.offset + rows.length)) {
		throw new InvalidHistoryPayload();
	}
	return { rows, nextOffset };
}

export function readCommandHistoryList(input: unknown, query: HistoryListQuery): CommandHistoryListResponse {
	const value = page(input, 'command', query);
	return {
		entries: value.rows.map((row) => ({ id: row.id, command: row.text, timestamp: row.timestamp })),
		nextOffset: value.nextOffset,
	};
}

export function readPathHistoryList(input: unknown, query: HistoryListQuery): PathHistoryListResponse {
	const value = page(input, 'path', query);
	return {
		entries: value.rows.map((row) => ({ id: row.id, path: row.text, timestamp: row.timestamp })),
		nextOffset: value.nextOffset,
	};
}

export function readHistoryAddResponse(input: unknown): HistoryAddResponse {
	const value = object(input, ['id']);
	return { id: bounded(value.id, 1) };
}

export function readHistoryDeleteResponse(input: unknown): HistoryDeleteResponse {
	const value = object(input, ['deleted']);
	if (value.deleted !== true) {
		throw new InvalidHistoryPayload();
	}
	return { deleted: true };
}

export function readHistoryClearResponse(input: unknown): HistoryClearResponse {
	const value = object(input, ['count']);
	return { count: bounded(value.count, 0, 10000) };
}

export function readHistoryError(input: unknown): HistoryErrorResponse {
	const value = object(input, ['code']);
	const code = HISTORY_ERROR_CODES.find((candidate) => candidate === value.code);
	if (!code) {
		throw new InvalidHistoryPayload();
	}
	return { code };
}
