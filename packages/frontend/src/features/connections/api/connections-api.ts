import { requestTarget } from '@/client/targets/target-request';
import { targetNumber, readTargetDeleted, InvalidTargetPayload } from '@nexus-terminal/shared/targets/http';
import {
	readConnectionList,
	readConnectionView,
	readConnectionUpdateRequest,
	readConnectionMutation,
	readConnectionCloneRequest,
	readConnectionImportRequest,
	readConnectionImportResponse,
	readCredentialView,
	readCredentialSetRequest,
	readCredentialClearRequest,
	readCredentialMutation,
	readConnectionAddTagRequest,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import { readTagConnectionsResponse } from '@nexus-terminal/shared/targets/tags/http-codec';
import type {
	TargetConnectionChanges,
	TargetImportInput,
	TargetImportItem,
	TargetCredentialInput,
} from '@nexus-terminal/shared/targets/connections/http';
import type { ConnectionSummary, CredentialSummary } from '../model/connection-types';
import { toConnectionSummary, toCredentialSummary } from '../model/connection-mapper';

export const connectionsApi = {
	async list(signal?: AbortSignal): Promise<ConnectionSummary[]> {
		return (
			await requestTarget({
				method: 'GET',
				path: '/connections',
				status: 200,
				decode: readConnectionList,
				signal,
			})
		).map((item) => toConnectionSummary(item));
	},

	async get(id: number, signal?: AbortSignal): Promise<ConnectionSummary> {
		const item = await requestTarget({
			method: 'GET',
			path: `/connections/${id}`,
			status: 200,
			signal,

			input: () => {
				targetNumber(id);
				return undefined;
			},

			decode: (value) => {
				const row = readConnectionView(value);
				if (row.id !== id) {
					throw new InvalidTargetPayload();
				}
				return row;
			},
		});
		return toConnectionSummary(item);
	},

	async update(
		snapshot: ConnectionSummary,
		changes: TargetConnectionChanges,
		signal?: AbortSignal,
	): Promise<ConnectionSummary> {
		const id = snapshot.id;
		const version = snapshot.version;
		const item = await requestTarget({
			method: 'PUT',
			path: `/connections/${id}`,
			status: 200,
			signal,

			input: () => {
				targetNumber(id);
				return readConnectionUpdateRequest({ version, changes });
			},

			decode: (value) => {
				const result = readConnectionMutation(value);
				if (result.status !== 'updated' || result.value.id !== id || result.value.version !== version + 1) {
					throw new InvalidTargetPayload();
				}
				return result.value;
			},
		});
		return toConnectionSummary(item);
	},

	async remove(id: number, signal?: AbortSignal): Promise<void> {
		await requestTarget({
			method: 'DELETE',
			path: `/connections/${id}`,
			status: 200,
			decode: readTargetDeleted,
			signal,

			input: () => {
				targetNumber(id);
				return undefined;
			},
		});
	},

	async clone(id: number, name: string, signal?: AbortSignal): Promise<ConnectionSummary> {
		const result = await requestTarget({
			method: 'POST',
			path: `/connections/${id}/clone`,
			status: 201,
			signal,

			input: () => {
				targetNumber(id);
				return readConnectionCloneRequest({ name });
			},

			decode: (value) => {
				const row = readConnectionView(value);
				if (row.id === id || row.version !== 1 || row.name !== name.trim()) {
					throw new InvalidTargetPayload();
				}
				return row;
			},
		});
		return toConnectionSummary(result);
	},

	async importMany(items: TargetImportInput[], signal?: AbortSignal): Promise<TargetImportItem[]> {
		const result = await requestTarget({
			method: 'POST',
			path: '/connections/import',
			status: 200,
			signal,

			input: () => readConnectionImportRequest({ items }),

			decode: (value) => {
				const row = readConnectionImportResponse(value);
				if (row.items.length !== items.length) {
					throw new InvalidTargetPayload();
				}
				const ids = row.items.flatMap((item) => (item.status === 'ok' ? [item.id] : []));
				if (new Set(ids).size !== ids.length) {
					throw new InvalidTargetPayload();
				}
				return row;
			},
		});
		return result.items.map((item) =>
			item.status === 'ok' ? { status: 'ok', id: item.id } : { status: 'error', code: item.code },
		);
	},

	async credential(id: number, signal?: AbortSignal): Promise<CredentialSummary> {
		const result = await requestTarget({
			method: 'GET',
			path: `/connections/${id}/credential`,
			status: 200,
			signal,

			input: () => {
				targetNumber(id);
				return undefined;
			},

			decode: (value) => {
				const row = readCredentialView(value);
				if (row.connectionId !== id) {
					throw new InvalidTargetPayload();
				}
				return row;
			},
		});
		return toCredentialSummary(result);
	},

	async setCredential(
		snapshot: ConnectionSummary,
		credential: TargetCredentialInput | null,
		signal?: AbortSignal,
	): Promise<void> {
		const id = snapshot.id;
		const version = snapshot.version;
		await requestTarget({
			method: credential === null ? 'DELETE' : 'PUT',
			path: `/connections/${id}/credential`,
			status: 200,
			signal,

			input: () => {
				targetNumber(id);
				return credential === null
					? readCredentialClearRequest({ version })
					: readCredentialSetRequest({ version, credential });
			},

			decode: (value) => {
				const result = readCredentialMutation(value);
				if (result.status !== 'updated') {
					throw new InvalidTargetPayload();
				}
				return result;
			},
		});
	},

	async addTag(connectionIds: number[], tagId: number, signal?: AbortSignal): Promise<void> {
		await requestTarget({
			method: 'POST',
			path: '/connections/add-tag',
			status: 200,
			signal,

			input: () => readConnectionAddTagRequest({ connectionIds, tagId }),

			decode: readTagConnectionsResponse,
		});
	},
};
