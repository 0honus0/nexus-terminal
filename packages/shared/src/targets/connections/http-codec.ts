import { TARGET_CONNECTION_IMPORT_MAX_ITEMS } from './values.js';
import { CONNECTION_ROUTES, CONNECTION_TYPES } from './values.js';
import type { TargetConnectionView, TargetConnectionMutation } from './model.js';
import type {
	TargetConnectionInput,
	TargetConnectionChanges,
	TargetCredentialInput,
	TargetCredentialMutation,
	TargetImportInput,
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
import { TARGET_ERROR_CODES } from '../values.js';
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
	'rdpRemoteApp',
	'rdpRemoteAppDirectory',
	'rdpRemoteAppArguments',
	'tagIds',
	'jumpIds',
] as const;

function readFields(row: Record<string, unknown>): TargetConnectionInput {
	return {
		name: targetText(row.name, 128, false),
		type: targetOption(row.type, CONNECTION_TYPES),
		host: targetText(row.host, 512, false),
		port: targetNumber(row.port, 65535),
		username: targetText(row.username, 256),
		route: targetOption(row.route, CONNECTION_ROUTES),
		proxyId: row.proxyId === null ? null : targetNumber(row.proxyId),
		notes: targetNullable(row.notes, 4096),
		rdpRemoteApp: targetNullable(row.rdpRemoteApp, 256),
		rdpRemoteAppDirectory: targetNullable(row.rdpRemoteAppDirectory, 1024),
		rdpRemoteAppArguments: targetNullable(row.rdpRemoteAppArguments, 4096),
		tagIds: targetIds(row.tagIds),
		jumpIds: targetIds(row.jumpIds, 16),
	};
}

export function readConnectionInput(input: unknown): TargetConnectionInput {
	return readFields(targetObject(input, CONNECTION_FIELDS));
}

export function readConnectionView(input: unknown): TargetConnectionView {
	const row = targetObject(input, [...CONNECTION_FIELDS, 'id', 'version', 'createdAt', 'updatedAt']);
	return {
		id: targetNumber(row.id),
		version: targetNumber(row.version),
		createdAt: targetNumber(row.createdAt, Number.MAX_SAFE_INTEGER, 0),
		updatedAt: targetNumber(row.updatedAt, Number.MAX_SAFE_INTEGER, 0),
		...readFields(row),
	};
}

export function readConnectionChanges(input: unknown): TargetConnectionChanges {
	const row = targetObject(input, CONNECTION_FIELDS, []);
	if (Object.keys(row).length === 0) {
		throw new InvalidTargetPayload();
	}
	const full: Partial<TargetConnectionInput> = {};
	for (const key of Object.keys(row) as (keyof TargetConnectionInput)[]) {
		const value = row[key];
		switch (key) {
			case 'name':
				full.name = targetText(value, 128, false);
				break;
			case 'type':
				full.type = targetOption(value, CONNECTION_TYPES);
				break;
			case 'host':
				full.host = targetText(value, 512, false);
				break;
			case 'port':
				full.port = targetNumber(value, 65535);
				break;
			case 'username':
				full.username = targetText(value, 256);
				break;
			case 'route':
				full.route = targetOption(value, CONNECTION_ROUTES);
				break;
			case 'proxyId':
				full.proxyId = value === null ? null : targetNumber(value);
				break;
			case 'notes':
				full.notes = targetNullable(value, 4096);
				break;
			case 'rdpRemoteApp':
				full.rdpRemoteApp = targetNullable(value, 256);
				break;
			case 'rdpRemoteAppDirectory':
				full.rdpRemoteAppDirectory = targetNullable(value, 1024);
				break;
			case 'rdpRemoteAppArguments':
				full.rdpRemoteAppArguments = targetNullable(value, 4096);
				break;
			case 'tagIds':
				full.tagIds = targetIds(value);
				break;
			case 'jumpIds':
				full.jumpIds = targetIds(value, 16);
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
	return { version: targetNumber(row.version), tagIds: targetIds(row.tagIds) };
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
	return { name: targetText(row.name, 128, false) };
}

export function readConnectionMutation(input: unknown): TargetConnectionMutation {
	return readTargetMutation(input, readConnectionView);
}

export function readCredentialInput(input: unknown): TargetCredentialInput {
	const row = targetObject(input, ['kind', 'password', 'sshKeyId'], ['kind']);
	if (row.kind === 'password') {
		targetObject(input, ['kind', 'password']);
		return { kind: 'password', password: targetText(row.password, 8192, false) };
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
	const row = targetObject(input, ['connection', 'inlineProxy', 'tagNames'], ['connection']);
	const value: TargetImportInput = { connection: readConnectionInput(row.connection) };
	if (row.inlineProxy !== undefined) {
		const proxy = readProxyInput(row.inlineProxy);
		if (proxy.password !== undefined) {
			throw new InvalidTargetPayload();
		}
		value.inlineProxy = {
			name: proxy.name,
			type: proxy.type,
			host: proxy.host,
			port: proxy.port,
			username: proxy.username,
		};
	}
	if (row.tagNames !== undefined) {
		const names = targetArray(row.tagNames, (v) => targetText(v, 128, false));
		if (new Set(names).size !== names.length) {
			throw new InvalidTargetPayload();
		}
		value.tagNames = names;
	}
	return value;
}

export function readConnectionImportRequest(input: unknown): TargetConnectionImportRequest {
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
					return { status: 'error', code: targetOption(value.code, TARGET_ERROR_CODES) };
				}
				throw new InvalidTargetPayload();
			},
			TARGET_CONNECTION_IMPORT_MAX_ITEMS,
		),
	};
}
