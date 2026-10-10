import {
	targetArray,
	readTargetDeleted,
	readTargetError,
	encodeTargetRequest,
} from '@nexus-terminal/shared/targets/http';
import {
	readConnectionView,
	readConnectionMutation,
	readCredentialMutation,
	readConnectionImportResponse,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import { readProxyView, readProxyMutation } from '@nexus-terminal/shared/targets/proxies/http-codec';
import { readTagView, readTagMutation } from '@nexus-terminal/shared/targets/tags/http-codec';
import { readSshKeyView, readSshKeyMutation } from '@nexus-terminal/shared/targets/ssh-keys/http-codec';
import { readHostKeyView, readHostKeyRemoveResponse } from '@nexus-terminal/shared/targets/host-keys/http-codec';
import type { TargetConnectionView, TargetConnectionMutation } from '@nexus-terminal/shared/targets/connections/model';
import type {
	TargetConnectionInput,
	TargetConnectionChanges,
	TargetCredentialInput,
	TargetCredentialMutation,
	TargetImportInput,
	TargetImportItem,
} from '@nexus-terminal/shared/targets/connections/http';
import type { TargetProxyView, TargetProxyMutation } from '@nexus-terminal/shared/targets/proxies/model';
import type { TargetProxyInput, TargetProxyChanges } from '@nexus-terminal/shared/targets/proxies/http';
import type { TargetTagView, TargetTagMutation } from '@nexus-terminal/shared/targets/tags/model';
import type { TargetSshKeyView, TargetSshKeyMutation } from '@nexus-terminal/shared/targets/ssh-keys/model';
import type { TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http';
import type { TargetHostKeyView } from '@nexus-terminal/shared/targets/host-keys/model';

import {
	readConnectionInput,
	readConnectionUpdateRequest,
	readConnectionCloneRequest,
	readConnectionTagsRequest,
	readCredentialSetRequest,
	readCredentialClearRequest,
	readConnectionImportRequest,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import { readProxyInput, readProxyUpdateRequest } from '@nexus-terminal/shared/targets/proxies/http-codec';
import { readSshKeyInput, readSshKeyUpdateRequest } from '@nexus-terminal/shared/targets/ssh-keys/http-codec';
import { readTagCreateRequest, readTagRenameRequest } from '@nexus-terminal/shared/targets/tags/http-codec';
import { readHostKeyConfirmRequest, readHostKeyRequest } from '@nexus-terminal/shared/targets/host-keys/http-codec';

/** All calls use one explicit same-origin backend and its session cookie. */
export function createTargetsNextApi(baseUrl: string) {
	const origin = new URL(baseUrl, window.location.href);
	if (origin.origin !== window.location.origin || origin.pathname !== '/__next/' || origin.search || origin.hash) {
		throw new Error('Targets management requires an explicit same-origin backend');
	}
	const base = origin.origin + '/__next/api/v1/targets';

	async function call(method: string, path: string, body?: unknown): Promise<unknown> {
		const encodedBody = body === undefined ? undefined : encodeTargetRequest(path, body);
		let response: Response;
		try {
			response = await fetch(base + path, {
				method,
				credentials: 'same-origin',
				cache: 'no-store',
				headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
				...(body === undefined ? {} : { body: encodedBody }),
			});
		} catch {
			throw new Error('request_failed');
		}
		let parsed: unknown;
		try {
			parsed = (await response.json()) as unknown;
		} catch {
			throw new Error('request_failed');
		}
		if (!response.ok) {
			const code = (() => {
				try {
					return readTargetError(parsed).code;
				} catch {
					return null;
				}
			})();
			if (code !== null) throw new Error(code);
			throw new Error('request_failed');
		}
		return parsed;
	}

	return {
		hostKeys: {
			list: async (): Promise<TargetHostKeyView[]> =>
				targetArray(await call('GET', '/host-keys'), readHostKeyView),

			confirm: async (host: string, port: number, fingerprint: string): Promise<TargetHostKeyView> =>
				readHostKeyView(
					await call('POST', '/host-keys/confirm', readHostKeyConfirmRequest({ host, port, fingerprint })),
				),

			remove: async (host: string, port: number): Promise<void> => {
				readHostKeyRemoveResponse(await call('POST', '/host-keys/remove', readHostKeyRequest({ host, port })));
			},
		},

		connections: {
			list: async (): Promise<TargetConnectionView[]> =>
				targetArray(await call('GET', '/connections'), readConnectionView),

			get: async (id: number): Promise<TargetConnectionView> =>
				readConnectionView(await call('GET', `/connections/${id}`)),

			create: async (input: TargetConnectionInput): Promise<TargetConnectionView> =>
				readConnectionView(await call('POST', '/connections', readConnectionInput(input))),

			update: async (
				id: number,
				version: number,
				changes: TargetConnectionChanges,
			): Promise<TargetConnectionMutation> =>
				readConnectionMutation(
					await call('PUT', `/connections/${id}`, readConnectionUpdateRequest({ version, changes })),
				),

			clone: async (id: number, name: string): Promise<TargetConnectionView> =>
				readConnectionView(
					await call('POST', `/connections/${id}/clone`, readConnectionCloneRequest({ name })),
				),

			remove: async (id: number): Promise<void> => {
				readTargetDeleted(await call('DELETE', `/connections/${id}`));
			},

			tags: async (id: number, version: number, tagIds: number[]): Promise<TargetConnectionMutation> =>
				readConnectionMutation(
					await call('PUT', `/connections/${id}/tags`, readConnectionTagsRequest({ version, tagIds })),
				),

			credential: async (
				id: number,
				version: number,
				value: TargetCredentialInput,
			): Promise<TargetCredentialMutation> =>
				readCredentialMutation(
					await call(
						'PUT',
						`/connections/${id}/credential`,
						readCredentialSetRequest({ version, credential: value }),
					),
				),

			clearCredential: async (id: number, version: number): Promise<TargetCredentialMutation> =>
				readCredentialMutation(
					await call('DELETE', `/connections/${id}/credential`, readCredentialClearRequest({ version })),
				),

			importMany: async (items: TargetImportInput[]): Promise<TargetImportItem[]> =>
				readConnectionImportResponse(
					await call('POST', '/connections/import', readConnectionImportRequest({ items })),
				).items,
		},
		proxies: {
			list: async (): Promise<TargetProxyView[]> => targetArray(await call('GET', '/proxies'), readProxyView),

			get: async (id: number): Promise<TargetProxyView> => readProxyView(await call('GET', `/proxies/${id}`)),

			create: async (input: TargetProxyInput): Promise<TargetProxyView> =>
				readProxyView(await call('POST', '/proxies', readProxyInput(input))),

			update: async (id: number, version: number, changes: TargetProxyChanges): Promise<TargetProxyMutation> =>
				readProxyMutation(await call('PUT', `/proxies/${id}`, readProxyUpdateRequest({ version, changes }))),

			remove: async (id: number): Promise<void> => {
				readTargetDeleted(await call('DELETE', `/proxies/${id}`));
			},
		},
		tags: {
			list: async (): Promise<TargetTagView[]> => targetArray(await call('GET', '/tags'), readTagView),

			get: async (id: number): Promise<TargetTagView> => readTagView(await call('GET', `/tags/${id}`)),

			create: async (name: string): Promise<TargetTagView> =>
				readTagView(await call('POST', '/tags', readTagCreateRequest({ name }))),

			rename: async (id: number, version: number, name: string): Promise<TargetTagMutation> =>
				readTagMutation(await call('PUT', `/tags/${id}`, readTagRenameRequest({ version, name }))),

			remove: async (id: number): Promise<void> => {
				readTargetDeleted(await call('DELETE', `/tags/${id}`));
			},
		},
		sshKeys: {
			list: async (): Promise<TargetSshKeyView[]> => targetArray(await call('GET', '/ssh-keys'), readSshKeyView),

			get: async (id: number): Promise<TargetSshKeyView> => readSshKeyView(await call('GET', `/ssh-keys/${id}`)),

			create: async (input: TargetSshKeyInput): Promise<TargetSshKeyView> =>
				readSshKeyView(await call('POST', '/ssh-keys', readSshKeyInput(input))),

			update: async (id: number, version: number, changes: TargetSshKeyChanges): Promise<TargetSshKeyMutation> =>
				readSshKeyMutation(await call('PUT', `/ssh-keys/${id}`, readSshKeyUpdateRequest({ version, changes }))),

			remove: async (id: number): Promise<void> => {
				readTargetDeleted(await call('DELETE', `/ssh-keys/${id}`));
			},
		},
	};
}
