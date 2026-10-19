import { readTargetDeleted, targetNumber } from '@nexus-terminal/shared/targets/http';
import {
	readTagList,
	readTagView,
	readTagCreateRequest,
	readTagRenameRequest,
	readTagMutation,
	readTagConnectionsRequest,
	readTagConnectionsResponse,
} from '@nexus-terminal/shared/targets/tags/http-codec';
import { requestTarget } from '@/client/targets/target-request';
import { toTagSummary, toTagCreate, toTagRename } from '../model/tag-mapper';
import type { TagSummary } from '../model/tag-types';

export const tagsApi = {
	async list(signal?: AbortSignal): Promise<TagSummary[]> {
		return (await requestTarget({ method: 'GET', path: '/tags', status: 200, decode: readTagList, signal })).map(
			toTagSummary,
		);
	},

	async create(name: string, signal?: AbortSignal): Promise<TagSummary> {
		return toTagSummary(
			await requestTarget({
				method: 'POST',
				path: '/tags',
				status: 201,

				input: () => readTagCreateRequest(toTagCreate(name)),

				decode: readTagView,
				signal,
			}),
		);
	},

	async rename(snapshot: TagSummary, name: string, signal?: AbortSignal): Promise<TagSummary> {
		const id = snapshot.id;
		const version = snapshot.version;
		return toTagSummary(
			await requestTarget({
				method: 'PUT',
				path: `/tags/${id}`,
				status: 200,

				input: () => {
					targetNumber(id);
					return readTagRenameRequest(toTagRename(version, name));
				},

				decode: (value) => {
					const result = readTagMutation(value);
					if (result.status !== 'updated' || result.value.id !== id || result.value.version !== version + 1) {
						throw new Error('Unrelated tag mutation');
					}
					return result.value;
				},

				signal,
			}),
		);
	},

	async remove(id: number, signal?: AbortSignal): Promise<void> {
		await requestTarget({
			method: 'DELETE',
			path: `/tags/${id}`,
			status: 200,

			input: () => {
				targetNumber(id);
				return undefined;
			},

			decode: readTargetDeleted,
			signal,
		});
	},

	async setConnections(id: number, connectionIds: number[], signal?: AbortSignal): Promise<void> {
		await requestTarget({
			method: 'PUT',
			path: `/tags/${id}/connections`,
			status: 200,

			input: () => {
				targetNumber(id);
				return readTagConnectionsRequest({ connectionIds: connectionIds.map((value) => value) });
			},

			decode: readTagConnectionsResponse,
			signal,
		});
	},
};
