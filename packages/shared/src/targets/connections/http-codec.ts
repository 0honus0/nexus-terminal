import {
	CONNECTION_ROUTES,
	CONNECTION_TYPES,
	TARGET_CONNECTION_NAME_MAX_BYTES,
	TARGET_CONNECTION_PASSWORD_MAX_BYTES,
	TARGET_CONNECTION_HOST_MAX_BYTES,
	TARGET_CONNECTION_USERNAME_MAX_BYTES,
	TARGET_CONNECTION_NOTES_MAX_BYTES,
	TARGET_CONNECTION_IMPORT_MAX_ITEMS,
	TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES,
	TARGET_IMPORT_ERROR_CODES,
	TARGET_CONNECTION_MAX_TAGS,
	TARGET_CONNECTION_MAX_JUMPS,
} from './values.js';
import {
	TARGET_SSH_KEY_NAME_MAX_BYTES,
	TARGET_SSH_PRIVATE_KEY_MAX_BYTES,
	TARGET_SSH_PASSPHRASE_MAX_BYTES,
} from '../ssh-keys/values.js';
import type { TargetConnectionView, TargetConnectionMutation, TargetCredentialView } from './model.js';
import type {
	TargetConnectionInput,
	TargetConnectionChanges,
	TargetCredentialInput,
	TargetCredentialMutation,
	TargetImportInput,
	TargetImportCredential,
	TargetImportItem,
	TargetConnectionUpdateRequest,
	TargetConnectionTagsRequest,
	TargetCredentialSetRequest,
	TargetCredentialClearRequest,
	TargetConnectionCloneRequest,
	TargetConnectionImportResponse,
	TargetConnectionImportRequest,
} from './http.js';
import {
	targetObject,
	targetText,
	targetNullable,
	targetNumber,
	targetArray,
	targetIds,
	targetOption,
	readTargetMutation,
	InvalidTargetPayload,
} from '../http.js';
import type { TargetConnectionAddTagRequest } from './http.js';
import { readTagConnectionIds } from '../tags/http-codec.js';
import { TARGET_MANAGEMENT_MAX_ITEMS } from '../values.js';
import { TARGET_TAG_NAME_MAX_BYTES } from '../tags/values.js';
import { readProxyInput } from '../proxies/http-codec.js';

export const CONNECTION_FIELDS = [
	'name',
	'type',
	'host',
	'port',
	'username',
	'route',
	'proxyId',
	'notes',
	'tagIds',
	'jumpIds',
] as const;

function readFields(row: Record<string, unknown>): TargetConnectionInput {
	return {
		name: targetText(row.name, TARGET_CONNECTION_NAME_MAX_BYTES, false),
		type: targetOption(row.type, CONNECTION_TYPES),
		host: targetText(row.host, TARGET_CONNECTION_HOST_MAX_BYTES, false),
		port: targetNumber(row.port, 65535),
		username: targetText(row.username, TARGET_CONNECTION_USERNAME_MAX_BYTES),
		route: targetOption(row.route, CONNECTION_ROUTES),
		proxyId: row.proxyId === null ? null : targetNumber(row.proxyId),
		notes: targetNullable(row.notes, TARGET_CONNECTION_NOTES_MAX_BYTES),
		tagIds: targetIds(row.tagIds, TARGET_CONNECTION_MAX_TAGS),
		jumpIds: targetIds(row.jumpIds, TARGET_CONNECTION_MAX_JUMPS),
	};
}

export function readConnectionInput(input: unknown): TargetConnectionInput {
	return readFields(targetObject(input, CONNECTION_FIELDS));
}

export function readConnectionView(input: unknown): TargetConnectionView {
	const row = targetObject(input, [
		...CONNECTION_FIELDS,
		'id',
		'version',
		'createdAt',
		'updatedAt',
		'lastConnectedAt',
	]);
	const fields = readFields(row);
	if (
		targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, 0) <
		targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0)
	) {
		throw new InvalidTargetPayload();
	}
	return {
		id: targetNumber(row.id),
		version: targetNumber(row.version),
		createdAt: targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0),
		updatedAt: targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, 0),
		lastConnectedAt:
			row.lastConnectedAt === null
				? null
				: targetNumber(
						row.lastConnectedAt,
						Number.MAX_SAFE_INTEGER,
						targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0),
					),
		name: fields.name,
		type: fields.type,
		host: fields.host,
		port: fields.port,
		username: fields.username,
		route: fields.route,
		proxyId: fields.proxyId,
		notes: fields.notes,
		tagIds: fields.tagIds,
		jumpIds: fields.jumpIds,
	};
}

export function readConnectionChanges(input: unknown): TargetConnectionChanges {
	const row = targetObject(input, CONNECTION_FIELDS, []);
	if (Object.keys(row).length === 0) {
		throw new InvalidTargetPayload();
	}
	const full: Partial<TargetConnectionInput> = {};
	for (const key of Object.keys(row)) {
		const value = row[key];
		switch (key) {
			case 'name':
				full.name = targetText(value, TARGET_CONNECTION_NAME_MAX_BYTES, false);
				break;
			case 'type':
				full.type = targetOption(value, CONNECTION_TYPES);
				break;
			case 'host':
				full.host = targetText(value, TARGET_CONNECTION_HOST_MAX_BYTES, false);
				break;
			case 'port':
				full.port = targetNumber(value, 65535);
				break;
			case 'username':
				full.username = targetText(value, TARGET_CONNECTION_USERNAME_MAX_BYTES);
				break;
			case 'route':
				full.route = targetOption(value, CONNECTION_ROUTES);
				break;
			case 'proxyId':
				full.proxyId = value === null ? null : targetNumber(value);
				break;
			case 'notes':
				full.notes = targetNullable(value, TARGET_CONNECTION_NOTES_MAX_BYTES);
				break;
			case 'tagIds':
				full.tagIds = targetIds(value, TARGET_CONNECTION_MAX_TAGS);
				break;
			case 'jumpIds':
				full.jumpIds = targetIds(value, TARGET_CONNECTION_MAX_JUMPS);
				break;
		}
	}
	return full;
}

export function readConnectionUpdateRequest(input: unknown): TargetConnectionUpdateRequest {
	const row = targetObject(input, ['version', 'changes']);
	return { version: targetNumber(row.version), changes: readConnectionChanges(row.changes) };
}

export function readConnectionTagsRequest(input: unknown): TargetConnectionTagsRequest {
	const row = targetObject(input, ['version', 'tagIds']);
	return { version: targetNumber(row.version), tagIds: targetIds(row.tagIds, TARGET_CONNECTION_MAX_TAGS) };
}

export function readCredentialSetRequest(input: unknown): TargetCredentialSetRequest {
	const row = targetObject(input, ['version', 'credential']);
	return { version: targetNumber(row.version), credential: readCredentialInput(row.credential) };
}

export function readCredentialClearRequest(input: unknown): TargetCredentialClearRequest {
	const row = targetObject(input, ['version']);
	return { version: targetNumber(row.version) };
}

export function readConnectionCloneRequest(input: unknown): TargetConnectionCloneRequest {
	const row = targetObject(input, ['name']);
	return { name: targetText(row.name, TARGET_CONNECTION_NAME_MAX_BYTES, false) };
}

export function readConnectionMutation(input: unknown): TargetConnectionMutation {
	return readTargetMutation(input, readConnectionView);
}

export function readCredentialInput(input: unknown): TargetCredentialInput {
	const row = targetObject(input, ['kind', 'password', 'sshKeyId'], ['kind']);
	if (row.kind === 'password') {
		targetObject(input, ['kind', 'password']);
		return { kind: 'password', password: targetText(row.password, TARGET_CONNECTION_PASSWORD_MAX_BYTES, false) };
	}
	if (row.kind === 'ssh_key') {
		targetObject(input, ['kind', 'sshKeyId']);
		return { kind: 'ssh_key', sshKeyId: targetNumber(row.sshKeyId) };
	}
	throw new InvalidTargetPayload();
}

export function readCredentialMutation(input: unknown): TargetCredentialMutation {
	const row = targetObject(input, ['status']);
	if (row.status === 'updated' || row.status === 'not_found' || row.status === 'version_conflict') {
		return { status: row.status };
	}
	throw new InvalidTargetPayload();
}

export function readConnectionImportInput(input: unknown): TargetImportInput {
	const row = targetObject(input, ['connection', 'inlineProxy', 'tagNames', 'credential'], ['connection']);
	const value: TargetImportInput = { connection: readConnectionInput(row.connection) };
	if (row.inlineProxy !== undefined) {
		const proxy = readProxyInput(row.inlineProxy);
		if (proxy.password === null) {
			throw new InvalidTargetPayload();
		}
		value.inlineProxy = {
			name: proxy.name,
			type: proxy.type,
			host: proxy.host,
			port: proxy.port,
			username: proxy.username,
		};
		if (proxy.password !== undefined && proxy.password !== null) {
			value.inlineProxy.password = proxy.password;
		}
	}
	if (row.tagNames !== undefined) {
		const names = targetArray(
			row.tagNames,
			(v) => targetText(v, TARGET_TAG_NAME_MAX_BYTES, false),
			TARGET_CONNECTION_MAX_TAGS,
		);
		if (new Set(names).size !== names.length) {
			throw new InvalidTargetPayload();
		}
		value.tagNames = names;
	}
	if (row.credential !== undefined) {
		value.credential = readImportCredential(row.credential);
	}
	return value;
}

export function readConnectionAddTagRequest(input: unknown): TargetConnectionAddTagRequest {
	const row = targetObject(input, ['tagId', 'connectionIds']);
	const connectionIds = readTagConnectionIds(row.connectionIds);
	if (connectionIds.length === 0) {
		throw new InvalidTargetPayload();
	}
	return { tagId: targetNumber(row.tagId), connectionIds };
}

export function readImportCredential(input: unknown): TargetImportCredential {
	const row = targetObject(input, ['kind', 'name', 'privateKey', 'passphrase', 'password', 'sshKeyId'], ['kind']);
	if (row.kind !== 'private_key') {
		return readCredentialInput(input);
	}
	targetObject(input, ['kind', 'name', 'privateKey', 'passphrase']);
	return {
		kind: 'private_key',
		name: targetText(row.name, TARGET_SSH_KEY_NAME_MAX_BYTES, false),
		privateKey: targetText(row.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false),
		passphrase: targetNullable(row.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES),
	};
}

export function readConnectionImportRequest(input: unknown): TargetConnectionImportRequest {
	if (new TextEncoder().encode(JSON.stringify(input)).byteLength > TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES) {
		throw new InvalidTargetPayload();
	}
	const row = targetObject(input, ['items']);
	const items = targetArray(row.items, readConnectionImportInput, TARGET_CONNECTION_IMPORT_MAX_ITEMS);
	if (items.length === 0) {
		throw new InvalidTargetPayload();
	}
	return { items };
}

export function readConnectionImportResponse(input: unknown): TargetConnectionImportResponse {
	const row = targetObject(input, ['items']);
	return {
		items: targetArray(
			row.items,
			(item): TargetImportItem => {
				const value = targetObject(item, ['status', 'id', 'code'], ['status']);
				if (value.status === 'ok') {
					targetObject(item, ['status', 'id']);
					return { status: 'ok', id: targetNumber(value.id) };
				}
				if (value.status === 'error') {
					targetObject(item, ['status', 'code']);
					return { status: 'error', code: targetOption(value.code, TARGET_IMPORT_ERROR_CODES) };
				}
				throw new InvalidTargetPayload();
			},
			TARGET_CONNECTION_IMPORT_MAX_ITEMS,
		),
	};
}

export function readConnectionList(input: unknown): TargetConnectionView[] {
	const items = targetArray(input, readConnectionView, TARGET_MANAGEMENT_MAX_ITEMS);
	if (new Set(items.map((item) => item.id)).size !== items.length) {
		throw new InvalidTargetPayload();
	}
	return items;
}

export function readCredentialView(input: unknown): TargetCredentialView {
	const row = targetObject(input, ['connectionId', 'version', 'credential']);
	const value = targetObject(row.credential, ['kind', 'sshKeyId'], ['kind']);
	let credential: TargetCredentialView['credential'];
	if (value.kind === 'ssh_key') {
		targetObject(value, ['kind', 'sshKeyId']);
		credential = { kind: 'ssh_key', sshKeyId: targetNumber(value.sshKeyId) };
	} else if (value.kind === 'password' || value.kind === 'none') {
		targetObject(value, ['kind']);
		credential = { kind: value.kind };
	} else {
		throw new InvalidTargetPayload();
	}
	return { connectionId: targetNumber(row.connectionId), version: targetNumber(row.version), credential };
}
