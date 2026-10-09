import type {
	TargetConnectionInput,
	TargetConnectionChanges,
	TargetConnectionView,
	TargetCredentialInput,
	TargetImportInput,
} from '@nexus-terminal/shared/connections/model';
import type {
	TargetConnectionMutation,
	TargetCredentialMutation,
	TargetImportItem,
} from '@nexus-terminal/shared/connections/api';
import type { TargetProxyInput, TargetProxyChanges, TargetProxyView } from '@nexus-terminal/shared/proxies/model';
import type { TargetProxyMutation } from '@nexus-terminal/shared/proxies/api';
import type { TargetTagView } from '@nexus-terminal/shared/tags/model';
import type { TargetTagMutation } from '@nexus-terminal/shared/tags/api';
import type { TargetSshKeyInput, TargetSshKeyChanges, TargetSshKeyView } from '@nexus-terminal/shared/ssh-keys/model';
import type { TargetSshKeyMutation } from '@nexus-terminal/shared/ssh-keys/api';
import { CONNECTION_ROUTES, CONNECTION_TYPES } from '@nexus-terminal/shared/connections/values';
import { PROXY_TYPES } from '@nexus-terminal/shared/proxies/values';
import type { TargetErrorCode } from '@nexus-terminal/shared/targets/api';
import type { TargetHostKeyView } from '@nexus-terminal/shared/targets/host-keys';

type Json = Record<string, unknown>;

function object(value: unknown): Json {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Invalid Targets response');
	return value as Json;
}

function string(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Invalid Targets response');
	return value;
}

function nullable(value: unknown): string | null {
	return value === null ? null : string(value);
}

function number(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid Targets response');
	return value;
}

function array<T>(input: unknown, decode: (value: unknown) => T): T[] {
	if (!Array.isArray(input)) throw new Error('Invalid Targets response');
	return input.map((value: unknown) => decode(value));
}

function option<T extends string>(value: unknown, choices: readonly T[]): T {
	const accepted = choices.find((candidate) => candidate === value);
	if (accepted === undefined) throw new Error('Invalid Targets response');
	return accepted;
}

function connectionView(input: unknown): TargetConnectionView {
	const v = object(input);
	return {
		id: number(v.id),
		version: number(v.version),
		createdAt: number(v.createdAt),
		updatedAt: number(v.updatedAt),
		name: string(v.name),
		type: option(v.type, CONNECTION_TYPES),
		host: string(v.host),
		port: number(v.port),
		username: string(v.username),
		route: option(v.route, CONNECTION_ROUTES),
		proxyId: v.proxyId === null ? null : number(v.proxyId),
		notes: nullable(v.notes),
		rdpRemoteApp: nullable(v.rdpRemoteApp),
		rdpRemoteAppDirectory: nullable(v.rdpRemoteAppDirectory),
		rdpRemoteAppArguments: nullable(v.rdpRemoteAppArguments),
		tagIds: array(v.tagIds, number),
		jumpIds: array(v.jumpIds, number),
	};
}

function proxyView(input: unknown): TargetProxyView {
	const v = object(input);
	return {
		id: number(v.id),
		name: string(v.name),
		type: option(v.type, PROXY_TYPES),
		host: string(v.host),
		port: number(v.port),
		username: nullable(v.username),
		version: number(v.version),
		createdAt: number(v.createdAt),
		updatedAt: number(v.updatedAt),
	};
}

function tagView(input: unknown): TargetTagView {
	const v = object(input);
	return {
		id: number(v.id),
		name: string(v.name),
		version: number(v.version),
		createdAt: number(v.createdAt),
		updatedAt: number(v.updatedAt),
	};
}

function keyView(input: unknown): TargetSshKeyView {
	const v = object(input);
	return {
		id: number(v.id),
		name: string(v.name),
		version: number(v.version),
		createdAt: number(v.createdAt),
		updatedAt: number(v.updatedAt),
	};
}

function hostKeyView(input: unknown): TargetHostKeyView {
	const value = object(input);
	return {
		host: string(value.host),
		port: number(value.port),
		fingerprint: string(value.fingerprint),
		confirmedAt: number(value.confirmedAt),
	};
}

function mutation<T>(
	input: unknown,
	decode: (value: unknown) => T,
): { status: 'updated'; value: T } | { status: 'not_found' } | { status: 'version_conflict' } {
	const v = object(input);
	if (v.status === 'updated') return { status: 'updated', value: decode(v.value) };
	if (v.status === 'not_found' || v.status === 'version_conflict') return { status: v.status };
	throw new Error('Invalid Targets mutation response');
}

function credentialMutation(input: unknown): TargetCredentialMutation {
	const v = object(input);
	if (v.status === 'updated' || v.status === 'not_found' || v.status === 'version_conflict')
		return { status: v.status };
	throw new Error('Invalid Targets credentials response');
}

function imports(input: unknown): TargetImportItem[] {
	const v = object(input);
	return array(v.items, (item) => {
		const row = object(item);
		if (row.status === 'ok') return { status: 'ok', id: number(row.id) };
		if (row.status === 'error' && typeof row.code === 'string') {
			const allowed: readonly TargetErrorCode[] = [
				'invalid_input',
				'reference_not_found',
				'reference_in_use',
				'conflict',
				'unresolvable',
				'storage_unavailable',
				'internal_failure',
			];
			const code = allowed.find((candidate) => candidate === row.code);
			if (code === undefined) throw new Error('Invalid Targets import result');
			return { status: 'error', code };
		}
		throw new Error('Invalid Targets import result');
	});
}

/** All calls use one explicit same-origin backend and its session cookie. */
export function createTargetsNextApi(baseUrl: string) {
	const origin = new URL(baseUrl, window.location.href);
	if (
		origin.origin !== window.location.origin ||
		!['/', '/__next/'].includes(origin.pathname) ||
		origin.search ||
		origin.hash
	)
		throw new Error('Targets management requires an explicit same-origin backend');
	const base = origin.origin + (origin.pathname === '/__next/' ? '/__next' : '') + '/api/v1/targets';

	async function call(method: string, path: string, body?: unknown): Promise<unknown> {
		const response = await fetch(base + path, {
			method,
			credentials: 'same-origin',
			cache: 'no-store',
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const parsed: unknown = await response.json();
		if (!response.ok) {
			const error = object(parsed);
			throw new Error(typeof error.code === 'string' ? error.code : 'targets_request_failed');
		}
		return parsed;
	}

	return {
		hostKeys: {
			list: async (): Promise<TargetHostKeyView[]> => array(await call('GET', '/host-keys'), hostKeyView),

			confirm: async (host: string, port: number, fingerprint: string): Promise<TargetHostKeyView> =>
				hostKeyView(await call('POST', '/host-keys/confirm', { host, port, fingerprint })),

			remove: async (host: string, port: number): Promise<void> => {
				await call('POST', '/host-keys/remove', { host, port });
			},
		},

		connections: {
			list: async (): Promise<TargetConnectionView[]> => array(await call('GET', '/connections'), connectionView),

			get: async (id: number): Promise<TargetConnectionView> =>
				connectionView(await call('GET', `/connections/${id}`)),

			create: async (input: TargetConnectionInput): Promise<TargetConnectionView> =>
				connectionView(await call('POST', '/connections', input)),

			update: async (
				id: number,
				version: number,
				changes: TargetConnectionChanges,
			): Promise<TargetConnectionMutation> =>
				mutation(await call('PUT', `/connections/${id}`, { version, changes }), connectionView),

			clone: async (id: number, name: string): Promise<TargetConnectionView> =>
				connectionView(await call('POST', `/connections/${id}/clone`, { name })),

			remove: async (id: number): Promise<void> => {
				await call('DELETE', `/connections/${id}`);
			},

			tags: async (id: number, version: number, tagIds: number[]): Promise<TargetConnectionMutation> =>
				mutation(await call('PUT', `/connections/${id}/tags`, { version, tagIds }), connectionView),

			credential: async (
				id: number,
				version: number,
				value: TargetCredentialInput,
			): Promise<TargetCredentialMutation> =>
				credentialMutation(await call('PUT', `/connections/${id}/credential`, { version, credential: value })),

			clearCredential: async (id: number, version: number): Promise<TargetCredentialMutation> =>
				credentialMutation(await call('DELETE', `/connections/${id}/credential`, { version })),

			importMany: async (items: TargetImportInput[]): Promise<TargetImportItem[]> =>
				imports(await call('POST', '/connections/import', { items })),
		},
		proxies: {
			list: async (): Promise<TargetProxyView[]> => array(await call('GET', '/proxies'), proxyView),

			get: async (id: number): Promise<TargetProxyView> => proxyView(await call('GET', `/proxies/${id}`)),

			create: async (input: TargetProxyInput): Promise<TargetProxyView> =>
				proxyView(await call('POST', '/proxies', input)),

			update: async (id: number, version: number, changes: TargetProxyChanges): Promise<TargetProxyMutation> =>
				mutation(await call('PUT', `/proxies/${id}`, { version, changes }), proxyView),

			remove: async (id: number): Promise<void> => {
				await call('DELETE', `/proxies/${id}`);
			},
		},
		tags: {
			list: async (): Promise<TargetTagView[]> => array(await call('GET', '/tags'), tagView),

			get: async (id: number): Promise<TargetTagView> => tagView(await call('GET', `/tags/${id}`)),

			create: async (name: string): Promise<TargetTagView> => tagView(await call('POST', '/tags', { name })),

			rename: async (id: number, version: number, name: string): Promise<TargetTagMutation> =>
				mutation(await call('PUT', `/tags/${id}`, { version, name }), tagView),

			remove: async (id: number): Promise<void> => {
				await call('DELETE', `/tags/${id}`);
			},
		},
		sshKeys: {
			list: async (): Promise<TargetSshKeyView[]> => array(await call('GET', '/ssh-keys'), keyView),

			get: async (id: number): Promise<TargetSshKeyView> => keyView(await call('GET', `/ssh-keys/${id}`)),

			create: async (input: TargetSshKeyInput): Promise<TargetSshKeyView> =>
				keyView(await call('POST', '/ssh-keys', input)),

			update: async (id: number, version: number, changes: TargetSshKeyChanges): Promise<TargetSshKeyMutation> =>
				mutation(await call('PUT', `/ssh-keys/${id}`, { version, changes }), keyView),

			remove: async (id: number): Promise<void> => {
				await call('DELETE', `/ssh-keys/${id}`);
			},
		},
	};
}
