import { TARGET_ERROR_CODES, type TargetErrorCode } from './values.js';

/** Target wire input is deliberately strict and framework independent. */
export class InvalidTargetPayload extends Error {
	constructor() {
		super('invalid_target_payload');
	}
}

export type TargetHttpErrorCode =
	TargetErrorCode | 'unauthenticated' | 'forbidden' | 'not_found' | 'version_conflict' | 'body_too_large';

export interface TargetErrorResponse {
	code: TargetHttpErrorCode;
}

/** Complete UTF-8 JSON budgets, including envelopes and escaped field contents. */
export const TARGET_HTTP_BODY_LIMITS = {
	connections: 128 * 1024,
	proxies: 64 * 1024,
	'ssh-keys': 128 * 1024,
	tags: 16 * 1024,
	'host-keys': 16 * 1024,
} as const;

/** Paths are relative to /api/v1/targets on both server and client. */
export function targetHttpBodyLimit(path: string): number {
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

export interface TargetDeleteResponse {
	deleted: true;
}

export function targetObject(
	input: unknown,
	allowed: readonly string[],
	required: readonly string[] = allowed,
): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new InvalidTargetPayload();
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
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max)
		throw new InvalidTargetPayload();
	return input;
}

export function targetArray<T>(value: unknown, decode: (v: unknown) => T, max = 10_000): T[] {
	if (!Array.isArray(value) || value.length > max) throw new InvalidTargetPayload();
	return value.map((item: unknown) => decode(item));
}

export function targetIds(value: unknown, max = 64): number[] {
	const ids = targetArray(value, (item) => targetNumber(item), max);
	if (new Set(ids).size !== ids.length) throw new InvalidTargetPayload();
	return ids;
}

export function targetOption<T extends string>(value: unknown, options: readonly T[]): T {
	const match = options.find((candidate) => candidate === value);
	if (match === undefined) throw new InvalidTargetPayload();
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
	if (row.deleted !== true) throw new InvalidTargetPayload();
	return { deleted: true };
}

export function readTargetError(input: unknown): TargetErrorResponse {
	const row = targetObject(input, ['code']);
	const stable = [
		...TARGET_ERROR_CODES,
		'unauthenticated',
		'forbidden',
		'not_found',
		'version_conflict',
		'body_too_large',
	] as const;
	return { code: targetOption(row.code, stable) };
}
