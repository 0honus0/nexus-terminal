import {
	PROXY_TYPES,
	TARGET_PROXY_NAME_MAX_BYTES,
	TARGET_PROXY_HOST_MAX_BYTES,
	TARGET_PROXY_USERNAME_MAX_BYTES,
	TARGET_PROXY_PASSWORD_MAX_BYTES,
} from './values.js';
import type { TargetProxyView, TargetProxyMutation } from './model.js';
import type { TargetProxyInput, TargetProxyChanges, TargetProxyUpdateRequest } from './http.js';
import { TARGET_MANAGEMENT_MAX_ITEMS } from '../values.js';
import {
	targetObject,
	targetArray,
	targetText,
	targetNullable,
	targetNumber,
	targetOption,
	readTargetMutation,
	InvalidTargetPayload,
} from '../http.js';

export const PROXY_FIELDS = ['name', 'type', 'host', 'port', 'username', 'password'] as const;

export function readProxyInput(input: unknown): TargetProxyInput {
	const row = targetObject(input, PROXY_FIELDS, ['name', 'type', 'host', 'port', 'username']);
	return {
		name: targetText(row.name, TARGET_PROXY_NAME_MAX_BYTES, false),
		type: targetOption(row.type, PROXY_TYPES),
		host: targetText(row.host, TARGET_PROXY_HOST_MAX_BYTES, false),
		port: targetNumber(row.port, 65535),
		username: targetNullable(row.username, TARGET_PROXY_USERNAME_MAX_BYTES),
		...(row.password === undefined
			? {}
			: { password: targetNullable(row.password, TARGET_PROXY_PASSWORD_MAX_BYTES) }),
	};
}

export function readProxyView(input: unknown): TargetProxyView {
	const row = targetObject(input, [
		'id',
		'name',
		'type',
		'host',
		'port',
		'username',
		'version',
		'createdAt',
		'updatedAt',
	]);
	const createdAt = targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0);
	const updatedAt = targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, createdAt);
	return {
		id: targetNumber(row.id),
		name: targetText(row.name, TARGET_PROXY_NAME_MAX_BYTES, false),
		type: targetOption(row.type, PROXY_TYPES),
		host: targetText(row.host, TARGET_PROXY_HOST_MAX_BYTES, false),
		port: targetNumber(row.port, 65535),
		username: targetNullable(row.username, TARGET_PROXY_USERNAME_MAX_BYTES),
		version: targetNumber(row.version),
		createdAt,
		updatedAt,
	};
}

export function readProxyList(input: unknown): TargetProxyView[] {
	const items = targetArray(input, readProxyView, TARGET_MANAGEMENT_MAX_ITEMS);
	if (new Set(items.map((item) => item.id)).size !== items.length) {
		throw new InvalidTargetPayload();
	}
	return items;
}

export function readProxyChanges(input: unknown): TargetProxyChanges {
	const row = targetObject(input, PROXY_FIELDS, []);
	if (!Object.keys(row).length) {
		throw new InvalidTargetPayload();
	}
	const changes: TargetProxyChanges = {};
	if (Object.hasOwn(row, 'name')) {
		changes.name = targetText(row.name, TARGET_PROXY_NAME_MAX_BYTES, false);
	}
	if (Object.hasOwn(row, 'type')) {
		changes.type = targetOption(row.type, PROXY_TYPES);
	}
	if (Object.hasOwn(row, 'host')) {
		changes.host = targetText(row.host, TARGET_PROXY_HOST_MAX_BYTES, false);
	}
	if (Object.hasOwn(row, 'port')) {
		changes.port = targetNumber(row.port, 65535);
	}
	if (Object.hasOwn(row, 'username')) {
		changes.username = targetNullable(row.username, TARGET_PROXY_USERNAME_MAX_BYTES);
	}
	if (Object.hasOwn(row, 'password')) {
		changes.password = targetNullable(row.password, TARGET_PROXY_PASSWORD_MAX_BYTES);
	}
	return changes;
}

export function readProxyUpdateRequest(input: unknown): TargetProxyUpdateRequest {
	const row = targetObject(input, ['version', 'changes']);
	return { version: targetNumber(row.version), changes: readProxyChanges(row.changes) };
}

export function readProxyMutation(input: unknown): TargetProxyMutation {
	return readTargetMutation(input, readProxyView);
}
