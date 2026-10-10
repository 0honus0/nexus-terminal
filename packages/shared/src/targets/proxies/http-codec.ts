import { PROXY_TYPES } from './values.js';
import type { TargetProxyView, TargetProxyMutation } from './model.js';
import type { TargetProxyInput, TargetProxyChanges, TargetProxyUpdateRequest } from './http.js';
import {
	targetObject,
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
		name: targetText(row.name, 128, false),
		type: targetOption(row.type, PROXY_TYPES),
		host: targetText(row.host, 512, false),
		port: targetNumber(row.port, 65535),
		username: targetNullable(row.username, 256),
		...(row.password === undefined ? {} : { password: targetNullable(row.password, 8192) }),
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
	return {
		id: targetNumber(row.id),
		name: targetText(row.name, 128, false),
		type: targetOption(row.type, PROXY_TYPES),
		host: targetText(row.host, 512, false),
		port: targetNumber(row.port, 65535),
		username: targetNullable(row.username, 256),
		version: targetNumber(row.version),
		createdAt: targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0),
		updatedAt: targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, 0),
	};
}

export function readProxyChanges(input: unknown): TargetProxyChanges {
	const row = targetObject(input, PROXY_FIELDS, []);
	if (!Object.keys(row).length) throw new InvalidTargetPayload();
	const changes: TargetProxyChanges = {};
	if (Object.hasOwn(row, 'name')) changes.name = targetText(row.name, 128, false);
	if (Object.hasOwn(row, 'type')) changes.type = targetOption(row.type, PROXY_TYPES);
	if (Object.hasOwn(row, 'host')) changes.host = targetText(row.host, 512, false);
	if (Object.hasOwn(row, 'port')) changes.port = targetNumber(row.port, 65535);
	if (Object.hasOwn(row, 'username')) changes.username = targetNullable(row.username, 256);
	if (Object.hasOwn(row, 'password')) changes.password = targetNullable(row.password, 8192);
	return changes;
}

export function readProxyUpdateRequest(input: unknown): TargetProxyUpdateRequest {
	const row = targetObject(input, ['version', 'changes']);
	return { version: targetNumber(row.version), changes: readProxyChanges(row.changes) };
}

export function readProxyMutation(input: unknown): TargetProxyMutation {
	return readTargetMutation(input, readProxyView);
}
