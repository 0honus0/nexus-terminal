import {
	readCommandCreate,
	readCommandUpdate,
	readCommandVersion,
	readCommandTagCreate,
	readCommandTagUpdate,
	readCommandAssign,
	readCommandGroupDelete,
	readCommandUntaggedGroupDelete,
	readCommandQuery,
	readCommandId,
	readCommandList,
	readCommandTagList,
	readCommandMutation,
	readCommandTagMutation,
	readCommandDelete,
	readCommandAssignResponse,
	readCommandError,
} from '@nexus-terminal/shared/preferences/commands/http-codec';
import {
	COMMAND_REQUEST_MAX_BYTES,
	COMMAND_RESPONSE_MAX_BYTES,
	COMMAND_PAGE_MAX_ENTRIES,
} from '@nexus-terminal/shared/preferences/commands/values';
import { requestPreference, listPreferencePages } from '@/client/preferences/preference-request';
import type { QuickCommandSummary, QuickCommandFormInput, QuickCommandTagSummary } from '../model/quick-command-types';
import { fromCommand, fromCommandTag } from '../model/quick-command-mapper';

const transport = {
	maxRequestBytes: COMMAND_REQUEST_MAX_BYTES,
	maxResponseBytes: COMMAND_RESPONSE_MAX_BYTES,
	decodeError: readCommandError,
};

function commandResult(value: unknown, original?: QuickCommandSummary): QuickCommandSummary {
	const item = readCommandMutation(value).command;
	if (original && (item.id !== original.id || item.version !== original.version + 1)) {
		throw new Error('Mismatched command mutation');
	}
	if (!original && item.version !== 1) {
		throw new Error('Mismatched command creation');
	}
	return fromCommand(item);
}

function tagResult(value: unknown, original?: QuickCommandTagSummary): QuickCommandTagSummary {
	const tag = readCommandTagMutation(value).tag;
	if (original && (tag.id !== original.id || tag.version !== original.version + 1)) {
		throw new Error('Mismatched command tag mutation');
	}
	if (!original && tag.version !== 1) {
		throw new Error('Mismatched command tag creation');
	}
	return fromCommandTag(tag);
}

export const quickCommandsApi = {
	async list(signal?: AbortSignal): Promise<QuickCommandSummary[]> {
		const entries = await listPreferencePages((offset) => {
			const query = new URLSearchParams({
				sortBy: 'name',
				offset: String(offset),
				limit: String(COMMAND_PAGE_MAX_ENTRIES),
			});
			const request = readCommandQuery(query);
			return requestPreference({
				...transport,
				method: 'GET',
				path: '/quick-commands?' + query,
				status: 200,
				signal,

				decode: (value) => readCommandList(value, request),
			});
		});
		return entries.map(fromCommand);
	},

	async create(input: QuickCommandFormInput, signal?: AbortSignal): Promise<QuickCommandSummary> {
		return requestPreference({
			...transport,
			method: 'POST',
			path: '/quick-commands',
			status: 201,
			signal,

			input: () =>
				readCommandCreate({
					name: input.name,
					command: input.command,
					variables: input.variables,
					tagIds: input.tagIds,
				}),

			decode: (value) => commandResult(value),
		});
	},

	async update(
		original: QuickCommandSummary,
		input: QuickCommandFormInput,
		signal?: AbortSignal,
	): Promise<QuickCommandSummary> {
		return requestPreference({
			...transport,
			method: 'PUT',
			path: '/quick-commands/' + readCommandId(String(original.id)),
			status: 200,
			signal,

			input: () =>
				readCommandUpdate({
					expectedVersion: original.version,
					name: input.name,
					command: input.command,
					variables: input.variables,
					tagIds: input.tagIds,
				}),

			decode: (value) => commandResult(value, original),
		});
	},

	async remove(original: QuickCommandSummary, signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...transport,
			method: 'DELETE',
			path: '/quick-commands/' + readCommandId(String(original.id)),
			status: 200,
			signal,

			input: () => readCommandVersion({ expectedVersion: original.version }),

			decode: readCommandDelete,
		});
	},

	async incrementUsage(original: QuickCommandSummary, signal?: AbortSignal): Promise<QuickCommandSummary> {
		return requestPreference({
			...transport,
			method: 'POST',
			path: '/quick-commands/' + readCommandId(String(original.id)) + '/increment-usage',
			status: 200,
			signal,

			input: () => readCommandVersion({ expectedVersion: original.version }),

			decode: (value) => commandResult(value, original),
		});
	},

	async listTags(signal?: AbortSignal): Promise<QuickCommandTagSummary[]> {
		const entries = await listPreferencePages((offset) => {
			const query = new URLSearchParams({ offset: String(offset), limit: String(COMMAND_PAGE_MAX_ENTRIES) });
			const request = readCommandQuery(query, true);
			return requestPreference({
				...transport,
				method: 'GET',
				path: '/quick-command-tags?' + query,
				status: 200,
				signal,

				decode: (value) => readCommandTagList(value, request),
			});
		});
		return entries.map(fromCommandTag);
	},

	async createTag(name: string, signal?: AbortSignal): Promise<QuickCommandTagSummary> {
		return requestPreference({
			...transport,
			method: 'POST',
			path: '/quick-command-tags',
			status: 201,
			signal,

			input: () => readCommandTagCreate({ name }),

			decode: (value) => tagResult(value),
		});
	},

	async renameTag(
		original: QuickCommandTagSummary,
		name: string,
		signal?: AbortSignal,
	): Promise<QuickCommandTagSummary> {
		return requestPreference({
			...transport,
			method: 'PUT',
			path: '/quick-command-tags/' + readCommandId(String(original.id)),
			status: 200,
			signal,

			input: () => readCommandTagUpdate({ name, expectedVersion: original.version }),

			decode: (value) => tagResult(value, original),
		});
	},

	async removeTag(original: QuickCommandTagSummary, signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...transport,
			method: 'DELETE',
			path: '/quick-command-tags/' + readCommandId(String(original.id)),
			status: 200,
			signal,

			input: () => readCommandVersion({ expectedVersion: original.version }),

			decode: readCommandDelete,
		});
	},

	async removeGroup(
		original: QuickCommandTagSummary | null,
		commands: QuickCommandSummary[],
		signal?: AbortSignal,
	): Promise<void> {
		await requestPreference({
			...transport,
			method: 'DELETE',
			path: original
				? '/quick-command-tags/' + readCommandId(String(original.id)) + '/group'
				: '/quick-commands/untagged-group',
			status: 200,
			signal,

			input: () => {
				const members = commands.map((command) => ({ id: command.id, expectedVersion: command.version }));
				return original
					? readCommandGroupDelete({ expectedVersion: original.version, commands: members })
					: readCommandUntaggedGroupDelete({ commands: members });
			},

			decode: readCommandDelete,
		});
	},

	async assignTag(commands: QuickCommandSummary[], tagId: number, signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...transport,
			method: 'POST',
			path: '/quick-commands/bulk-assign-tag',
			status: 200,
			signal,

			input: () =>
				readCommandAssign({
					commands: commands.map((item) => ({ id: item.id, expectedVersion: item.version })),
					tagId,
				}),

			decode: (value) => {
				const result = readCommandAssignResponse(value);
				if (result.count !== commands.filter((command) => !command.tagIds.includes(tagId)).length) {
					throw new Error('Mismatched command assignment');
				}
				return result;
			},
		});
	},
};
