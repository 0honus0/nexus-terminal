import type { FavoritePath } from './model.js';
import type {
	FavoritePathCreateRequest,
	FavoritePathUpdateRequest,
	FavoritePathVersionRequest,
	FavoritePathListQuery,
	FavoritePathListResponse,
	FavoritePathMutationResponse,
	FavoritePathDeleteResponse,
	FavoritePathErrorResponse,
} from './http.js';
import {
	FAVORITE_PATH_SORTS,
	FAVORITE_PATH_MAX_BYTES,
	FAVORITE_NAME_MAX_BYTES,
	FAVORITE_REQUEST_MAX_BYTES,
	FAVORITE_RESPONSE_MAX_BYTES,
	FAVORITE_PAGE_MAX_ENTRIES,
	FAVORITE_ERROR_CODES,
} from './values.js';

export class InvalidFavoritePayload extends Error {
	constructor() {
		super('Invalid favorite payload');
		this.name = 'InvalidFavoritePayload';
	}
}

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		input === null ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		Object.keys(input).length !== keys.length ||
		Object.keys(input).some((key) => !keys.includes(key))
	) {
		throw new InvalidFavoritePayload();
	}
	const value: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(input)) {
		value[key] = entry;
	}
	return value;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new InvalidFavoritePayload();
	}
	return value;
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		value.includes('\0') ||
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value ||
		new TextEncoder().encode(value).length > max
	) {
		throw new InvalidFavoritePayload();
	}
	return value;
}

function path(value: unknown): string {
	const result = text(value, FAVORITE_PATH_MAX_BYTES);
	if (!result.trim()) {
		throw new InvalidFavoritePayload();
	}
	return result;
}

function budget(input: unknown, max: number): void {
	const json = JSON.stringify(input);
	if (json === undefined || new TextEncoder().encode(json).length > max) {
		throw new InvalidFavoritePayload();
	}
}

export function readFavoriteCreate(input: unknown): FavoritePathCreateRequest {
	budget(input, FAVORITE_REQUEST_MAX_BYTES);
	const value = object(input, ['name', 'path']);
	return { name: value.name === null ? null : text(value.name, FAVORITE_NAME_MAX_BYTES), path: path(value.path) };
}

export function readFavoriteUpdate(input: unknown): FavoritePathUpdateRequest {
	budget(input, FAVORITE_REQUEST_MAX_BYTES);
	const value = object(input, ['expectedVersion', 'name', 'path']);
	return {
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		name: value.name === null ? null : text(value.name, FAVORITE_NAME_MAX_BYTES),
		path: path(value.path),
	};
}

export function readFavoriteVersion(input: unknown): FavoritePathVersionRequest {
	budget(input, FAVORITE_REQUEST_MAX_BYTES);
	const value = object(input, ['expectedVersion']);
	return { expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) };
}

export function readFavoriteId(input: unknown): number {
	if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input)) {
		throw new InvalidFavoritePayload();
	}
	return integer(Number(input), 1);
}

export function readFavoriteQuery(query: URLSearchParams): FavoritePathListQuery {
	const seen = new Set<string>();
	for (const [key, value] of query) {
		if (
			!['sortBy', 'offset', 'limit'].includes(key) ||
			seen.has(key) ||
			(key !== 'sortBy' && !/^(0|[1-9]\d*)$/.test(value))
		) {
			throw new InvalidFavoritePayload();
		}
		seen.add(key);
	}
	const sortBy = FAVORITE_PATH_SORTS.find((value) => value === (query.get('sortBy') ?? 'name'));
	if (!sortBy) {
		throw new InvalidFavoritePayload();
	}
	return {
		sortBy,
		offset: integer(Number(query.get('offset') ?? '0'), 0, 2000),
		limit: integer(Number(query.get('limit') ?? String(FAVORITE_PAGE_MAX_ENTRIES)), 1, FAVORITE_PAGE_MAX_ENTRIES),
	};
}

export function readFavoritePath(input: unknown): FavoritePath {
	const value = object(input, ['id', 'version', 'name', 'path', 'lastUsedAt', 'createdAt', 'updatedAt']);
	return {
		id: integer(value.id, 1),
		version: integer(value.version, 1),
		name: value.name === null ? null : text(value.name, FAVORITE_NAME_MAX_BYTES),
		path: path(value.path),
		lastUsedAt: value.lastUsedAt === null ? null : integer(value.lastUsedAt, 0),
		createdAt: integer(value.createdAt, 0),
		updatedAt: integer(value.updatedAt, 0),
	};
}

export function readFavoriteList(input: unknown, query: FavoritePathListQuery): FavoritePathListResponse {
	budget(input, FAVORITE_RESPONSE_MAX_BYTES);
	const value = object(input, ['entries', 'nextOffset']);
	if (
		!Array.isArray(value.entries) ||
		value.entries.length > query.limit ||
		value.entries.length > FAVORITE_PAGE_MAX_ENTRIES
	) {
		throw new InvalidFavoritePayload();
	}
	const entries = value.entries.map((row: unknown) => readFavoritePath(row));
	if (new Set(entries.map((row) => row.id)).size !== entries.length) {
		throw new InvalidFavoritePayload();
	}
	const nextOffset = value.nextOffset === null ? null : integer(value.nextOffset, 1, 2000);
	if (nextOffset !== null && (entries.length !== query.limit || nextOffset !== query.offset + entries.length)) {
		throw new InvalidFavoritePayload();
	}
	return { entries, nextOffset };
}

export function readFavoriteMutation(input: unknown): FavoritePathMutationResponse {
	budget(input, FAVORITE_RESPONSE_MAX_BYTES);
	const value = object(input, ['favoritePath']);
	return { favoritePath: readFavoritePath(value.favoritePath) };
}

export function readFavoriteDelete(input: unknown): FavoritePathDeleteResponse {
	const value = object(input, ['deleted']);
	if (value.deleted !== true) {
		throw new InvalidFavoritePayload();
	}
	return { deleted: true };
}

export function readFavoriteError(input: unknown): FavoritePathErrorResponse {
	const value = object(input, ['code']);
	const code = FAVORITE_ERROR_CODES.find((entry) => entry === value.code);
	if (!code) {
		throw new InvalidFavoritePayload();
	}
	return { code };
}
