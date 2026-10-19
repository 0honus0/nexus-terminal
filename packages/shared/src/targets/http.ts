import {
	TARGET_ERROR_CODES,
	TARGET_HTTP_BODY_LIMITS,
	TARGET_MANAGEMENT_RESPONSE_MAX_BYTES,
	type TargetHttpErrorCode,
} from './values.js';
import { TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES, CONNECTION_TEST_BODY_MAX_BYTES } from './connections/values.js';
import { TARGET_TAG_CONNECTION_BODY_MAX_BYTES } from './tags/values.js';

/** Target wire input is deliberately strict and framework independent. */
export class InvalidTargetPayload extends Error {
	constructor() {
		super('invalid_target_payload');
	}
}

export interface TargetErrorResponse {
	code: TargetHttpErrorCode;
}

/** Paths are relative to /api/v1/targets on both server and client. */
export function targetHttpBodyLimit(path: string): number {
	if (path === '/connections/add-tag' || /^\/tags\/[^/]+\/connections$/u.test(path)) {
		return TARGET_TAG_CONNECTION_BODY_MAX_BYTES;
	}
	if (path === '/connections/import') {
		return TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES;
	}
	if (/^\/connections\/(?:test-unsaved|[1-9]\d*\/test)$/u.test(path)) {
		return CONNECTION_TEST_BODY_MAX_BYTES;
	}
	const resource = path.split('/')[1];
	switch (resource) {
		case 'connections':
		case 'proxies':
		case 'ssh-keys':
		case 'tags':
		case 'host-keys':
			return TARGET_HTTP_BODY_LIMITS[resource];
		default:
			throw new InvalidTargetPayload();
	}
}

export function encodeTargetRequest(path: string, input: unknown): string {
	const body = JSON.stringify(input);
	if (body === undefined) {
		throw new InvalidTargetPayload();
	}
	if (new TextEncoder().encode(body).byteLength > targetHttpBodyLimit(path)) {
		throw new Error('body_too_large');
	}
	return body;
}

export function targetManagementResponseLimit(path: string): number {
	switch (path.split('/')[1]) {
		case 'connections':
			return path === '/connections'
				? TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.connections
				: TARGET_HTTP_BODY_LIMITS.connections;
		case 'proxies':
			return TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.proxies;
		case 'ssh-keys':
			return TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['ssh-keys'];
		case 'tags':
			return TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.tags;
		case 'host-keys':
			return TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['host-keys'];
		default:
			throw new InvalidTargetPayload();
	}
}

export interface TargetDeleteResponse {
	deleted: true;
}

export function targetObject(
	input: unknown,
	allowed: readonly string[],
	required: readonly string[] = allowed,
): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidTargetPayload();
	}
	const row = input as Record<string, unknown>;
	if (Object.keys(row).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(row, key))) {
		throw new InvalidTargetPayload();
	}
	return row;
}

export function targetText(input: unknown, max = 512, allowEmpty = true): string {
	if (
		typeof input !== 'string' ||
		new TextEncoder().encode(input).byteLength > max ||
		new TextDecoder().decode(new TextEncoder().encode(input)) !== input ||
		(!allowEmpty && !input.trim())
	) {
		throw new InvalidTargetPayload();
	}
	return input;
}

export function targetNullable(input: unknown, max = 512): string | null {
	return input === null ? null : targetText(input, max);
}

export function targetNumber(input: unknown, max = Number.MAX_SAFE_INTEGER, min = 1): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
		throw new InvalidTargetPayload();
	}
	return input;
}

export function targetArray<T>(value: unknown, decode: (v: unknown) => T, max = 10_000): T[] {
	if (!Array.isArray(value) || value.length > max) {
		throw new InvalidTargetPayload();
	}
	return value.map((item: unknown) => decode(item));
}

export function targetIds(value: unknown, max = 64): number[] {
	const ids = targetArray(value, (item) => targetNumber(item), max);
	if (new Set(ids).size !== ids.length) {
		throw new InvalidTargetPayload();
	}
	return ids;
}

export function targetOption<T extends string>(value: unknown, options: readonly T[]): T {
	const match = options.find((candidate) => candidate === value);
	if (match === undefined) {
		throw new InvalidTargetPayload();
	}
	return match;
}

export function readTargetMutation<T>(
	input: unknown,
	decode: (value: unknown) => T,
): { status: 'updated'; value: T } | { status: 'not_found' } | { status: 'version_conflict' } {
	const row = targetObject(input, ['status', 'value'], ['status']);
	switch (row.status) {
		case 'updated': {
			targetObject(input, ['status', 'value']);
			return { status: 'updated', value: decode(row.value) };
		}
		case 'not_found':
		case 'version_conflict':
			targetObject(input, ['status']);
			return { status: row.status };
		default:
			throw new InvalidTargetPayload();
	}
}

export function readTargetDeleted(input: unknown): TargetDeleteResponse {
	const row = targetObject(input, ['deleted']);
	if (row.deleted !== true) {
		throw new InvalidTargetPayload();
	}
	return { deleted: true };
}

export function readTargetError(input: unknown): TargetErrorResponse {
	const row = targetObject(input, ['code']);
	const stable = [
		...TARGET_ERROR_CODES,
		'not_found',
		'version_conflict',
		'body_too_large',
		'request_timeout',
		'limit_exceeded',
	] as const;
	return { code: targetOption(row.code, stable) };
}
