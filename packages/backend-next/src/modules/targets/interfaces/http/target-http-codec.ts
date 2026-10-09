import type {
	ConnectionMetadata,
	ConnectionImport,
	ProxyInput,
	ProxyUpdateInput,
	SshKeyInput,
	SshKeyChanges,
	SshCredentialInput,
} from '../../public.js';
import { CONNECTION_TYPES, CONNECTION_ROUTES } from '@nexus-terminal/shared/connections/values';
import { PROXY_TYPES } from '@nexus-terminal/shared/proxies/values';

export class InvalidTargetsInput extends Error {}

type Data = Record<string, unknown>;

export function fields(input: unknown, allowed: readonly string[], required: readonly string[] = []): Data {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new InvalidTargetsInput();
	const value = input as Data;
	if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) {
		throw new InvalidTargetsInput();
	}
	return value;
}

export function stringField(value: unknown, max = 512, empty = false): string {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > max || (!empty && !value.trim())) {
		throw new InvalidTargetsInput();
	}
	return value;
}

export function nullable(value: unknown, max: number): string | null {
	return value === null ? null : stringField(value, max, true);
}

export function numberField(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
		throw new InvalidTargetsInput();
	}
	return value;
}

export function urlId(value: string | undefined): number {
	if (!value || !/^[1-9][0-9]{0,14}$/u.test(value)) throw new InvalidTargetsInput();
	return numberField(Number(value));
}

export function ids(value: unknown, max = 64): number[] {
	if (!Array.isArray(value) || value.length > max) throw new InvalidTargetsInput();
	const numbers: number[] = value.map((item: unknown) => numberField(item));
	if (new Set(numbers).size !== numbers.length) throw new InvalidTargetsInput();
	return numbers;
}

export function variant<T extends string>(value: unknown, allowed: readonly T[]): T {
	if (typeof value !== 'string' || !allowed.some((item) => item === value)) throw new InvalidTargetsInput();
	return value as T;
}

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

export function connection(input: unknown): ConnectionMetadata {
	const v = fields(input, CONNECTION_FIELDS, CONNECTION_FIELDS);
	return {
		name: stringField(v.name, 128),
		type: variant(v.type, CONNECTION_TYPES),
		host: stringField(v.host, 512),
		port: numberField(v.port, 65535),
		username: stringField(v.username, 256, true),
		route: variant(v.route, CONNECTION_ROUTES),
		proxyId: v.proxyId === null ? null : numberField(v.proxyId),
		notes: nullable(v.notes, 4096),
		rdpRemoteApp: nullable(v.rdpRemoteApp, 256),
		rdpRemoteAppDirectory: nullable(v.rdpRemoteAppDirectory, 1024),
		rdpRemoteAppArguments: nullable(v.rdpRemoteAppArguments, 4096),
		tagIds: ids(v.tagIds),
		jumpIds: ids(v.jumpIds, 16),
	};
}

export function proxy(input: unknown): ProxyInput {
	const v = fields(
		input,
		['name', 'type', 'host', 'port', 'username', 'password'],
		['name', 'type', 'host', 'port', 'username'],
	);
	const result: ProxyInput = {
		name: stringField(v.name, 128),
		type: variant(v.type, PROXY_TYPES),
		host: stringField(v.host, 512),
		port: numberField(v.port, 65535),
		username: v.username === null ? null : stringField(v.username, 256, true),
	};
	if (v.password !== undefined) result.password = nullable(v.password, 8192);
	return result;
}

export function sshKey(input: unknown): SshKeyInput {
	const v = fields(input, ['name', 'privateKey', 'passphrase'], ['name', 'privateKey']);
	const result: SshKeyInput = { name: stringField(v.name, 128), privateKey: stringField(v.privateKey, 10000) };
	if (v.passphrase !== undefined) result.passphrase = nullable(v.passphrase, 8192);
	return result;
}

export function named(input: unknown): string {
	const value = fields(input, ['name'], ['name']);
	return stringField(value.name, 128);
}

export function versioned(input: unknown, key: string): { version: number; payload: unknown } {
	const value = fields(input, ['version', key], ['version', key]);
	return { version: numberField(value.version), payload: value[key] };
}

export function connectionChanges(input: unknown): Partial<ConnectionMetadata> {
	const value = fields(input, CONNECTION_FIELDS);
	if (!Object.keys(value).length) throw new InvalidTargetsInput();
	const patch: Partial<ConnectionMetadata> = {};
	if (value.name !== undefined) patch.name = stringField(value.name, 128);
	if (value.type !== undefined) patch.type = variant(value.type, CONNECTION_TYPES);
	if (value.host !== undefined) patch.host = stringField(value.host, 512);
	if (value.port !== undefined) patch.port = numberField(value.port, 65535);
	if (value.username !== undefined) patch.username = stringField(value.username, 256, true);
	if (value.route !== undefined) patch.route = variant(value.route, CONNECTION_ROUTES);
	if (value.proxyId !== undefined) patch.proxyId = value.proxyId === null ? null : numberField(value.proxyId);
	if (value.notes !== undefined) patch.notes = nullable(value.notes, 4096);
	if (value.rdpRemoteApp !== undefined) patch.rdpRemoteApp = nullable(value.rdpRemoteApp, 256);
	if (value.rdpRemoteAppDirectory !== undefined)
		patch.rdpRemoteAppDirectory = nullable(value.rdpRemoteAppDirectory, 1024);
	if (value.rdpRemoteAppArguments !== undefined)
		patch.rdpRemoteAppArguments = nullable(value.rdpRemoteAppArguments, 4096);
	if (value.tagIds !== undefined) patch.tagIds = ids(value.tagIds);
	if (value.jumpIds !== undefined) patch.jumpIds = ids(value.jumpIds, 16);
	return patch;
}

export function proxyChanges(input: unknown): ProxyUpdateInput {
	const value = fields(input, ['name', 'type', 'host', 'port', 'username', 'password']);
	if (!Object.keys(value).length) throw new InvalidTargetsInput();
	const patch: ProxyUpdateInput = {};
	if (value.name !== undefined) patch.name = stringField(value.name, 128);
	if (value.type !== undefined) patch.type = variant(value.type, PROXY_TYPES);
	if (value.host !== undefined) patch.host = stringField(value.host, 512);
	if (value.port !== undefined) patch.port = numberField(value.port, 65535);
	if (value.username !== undefined)
		patch.username = value.username === null ? null : stringField(value.username, 256, true);
	if (value.password !== undefined) patch.password = nullable(value.password, 8192);
	return patch;
}

export function keyChanges(input: unknown): SshKeyChanges {
	const value = fields(input, ['name', 'privateKey', 'passphrase']);
	if (!Object.keys(value).length) throw new InvalidTargetsInput();
	const patch: SshKeyChanges = {};
	if (value.name !== undefined) patch.name = stringField(value.name, 128);
	if (value.privateKey !== undefined) patch.privateKey = stringField(value.privateKey, 10000);
	if (value.passphrase !== undefined) patch.passphrase = nullable(value.passphrase, 8192);
	return patch;
}

export function credential(input: unknown): SshCredentialInput {
	const value = fields(input, ['kind', 'password', 'sshKeyId'], ['kind']);
	if (value.kind === 'password' && Object.keys(value).every((key) => ['kind', 'password'].includes(key))) {
		return { kind: 'password', password: stringField(value.password, 8192) };
	}
	if (value.kind === 'ssh_key' && Object.keys(value).every((key) => ['kind', 'sshKeyId'].includes(key))) {
		return { kind: 'ssh_key', sshKeyId: numberField(value.sshKeyId) };
	}
	throw new InvalidTargetsInput();
}

export function importBatch(input: unknown): ConnectionImport[] {
	const body = fields(input, ['items'], ['items']);
	if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw new InvalidTargetsInput();
	return body.items.map((item: unknown) => {
		const row = fields(item, ['connection', 'inlineProxy', 'tagNames'], ['connection']);
		const result: ConnectionImport = { connection: connection(row.connection) };
		if (row.inlineProxy !== undefined) {
			const value = proxy(row.inlineProxy);
			if (value.password !== undefined) throw new InvalidTargetsInput();
			result.inlineProxy = {
				name: value.name,
				type: value.type,
				host: value.host,
				port: value.port,
				username: value.username,
			};
		}
		if (row.tagNames !== undefined) {
			if (!Array.isArray(row.tagNames) || row.tagNames.length > 64) throw new InvalidTargetsInput();
			const names: string[] = row.tagNames.map((name: unknown) => stringField(name, 128));
			if (new Set(names).size !== names.length) throw new InvalidTargetsInput();
			result.tagNames = names;
		}
		return result;
	});
}
