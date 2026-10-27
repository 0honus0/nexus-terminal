import {
	readCommandHistoryAdd,
	readHistoryId,
	readHistoryListQuery,
	readCommandHistoryList,
	readHistoryAddResponse,
	readHistoryDeleteResponse,
	readHistoryClearResponse,
	readHistoryError,
} from '@nexus-terminal/shared/preferences/history/http-codec';
import {
	HISTORY_PAGE_MAX_ENTRIES,
	HISTORY_REQUEST_MAX_BYTES,
	HISTORY_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/history/values';
import { requestPreference, listPreferencePages } from '@/client/preferences/preference-request';
import { fromCommandHistory } from '../model/command-history-mapper';
import type { CommandHistoryItem } from '../model/command-history-types';

const transport = {
	maxRequestBytes: HISTORY_REQUEST_MAX_BYTES,
	maxResponseBytes: HISTORY_RESPONSE_MAX_BYTES,
	decodeError: readHistoryError,
};

export const commandHistoryApi = {
	async list(signal?: AbortSignal): Promise<CommandHistoryItem[]> {
		const entries = await listPreferencePages((offset) => {
			const query = new URLSearchParams({ offset: String(offset), limit: String(HISTORY_PAGE_MAX_ENTRIES) });
			const request = readHistoryListQuery(query);
			return requestPreference({
				...transport,
				method: 'GET',
				path: '/command-history?' + query,
				status: 200,
				signal,

				decode: (value) => readCommandHistoryList(value, request),
			});
		});
		return entries.map(fromCommandHistory);
	},

	async add(command: string, signal?: AbortSignal): Promise<number> {
		const result = await requestPreference({
			...transport,
			method: 'POST',
			path: '/command-history',
			status: 201,
			signal,

			input: () => readCommandHistoryAdd({ command }),

			decode: readHistoryAddResponse,
		});
		return result.id;
	},

	async remove(id: number, signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...transport,
			method: 'DELETE',
			path: '/command-history/' + readHistoryId(String(id)),
			status: 200,
			signal,
			decode: readHistoryDeleteResponse,
		});
	},

	async clear(signal?: AbortSignal): Promise<number> {
		const result = await requestPreference({
			...transport,
			method: 'DELETE',
			path: '/command-history',
			status: 200,
			signal,
			decode: readHistoryClearResponse,
		});
		return result.count;
	},
};
