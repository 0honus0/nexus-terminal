import {
	readFavoriteCreate,
	readFavoriteUpdate,
	readFavoriteVersion,
	readFavoriteId,
	readFavoriteQuery,
	readFavoriteList,
	readFavoriteMutation,
	readFavoriteDelete,
	readFavoriteError,
} from '@nexus-terminal/shared/preferences/favorites/http-codec';
import {
	FAVORITE_PAGE_MAX_ENTRIES,
	FAVORITE_REQUEST_MAX_BYTES,
	FAVORITE_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/favorites/values';
import {
	readPathHistoryAdd,
	readHistoryId,
	readHistoryListQuery,
	readPathHistoryList,
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
import type { FavoritePathSummary, FavoritePathSort } from '../model/catalog-types';
import { fromFavorite, fromPathHistory } from '../model/catalog-mapper';

const favoriteTransport = {
	maxRequestBytes: FAVORITE_REQUEST_MAX_BYTES,
	maxResponseBytes: FAVORITE_RESPONSE_MAX_BYTES,
	decodeError: readFavoriteError,
};
const historyTransport = {
	maxRequestBytes: HISTORY_REQUEST_MAX_BYTES,
	maxResponseBytes: HISTORY_RESPONSE_MAX_BYTES,
	decodeError: readHistoryError,
};

function favoriteMutation(value: unknown, original?: { id: number; version: number }): FavoritePathSummary {
	const item = readFavoriteMutation(value).favoritePath;
	if (original && (item.id !== original.id || item.version !== original.version + 1)) {
		throw new Error('Mismatched favorite mutation');
	}
	if (!original && item.version !== 1) {
		throw new Error('Mismatched favorite creation');
	}
	return fromFavorite(item);
}

export const filesystemCatalogApi = {
	async listFavorites(sort: FavoritePathSort, signal?: AbortSignal): Promise<FavoritePathSummary[]> {
		const items = await listPreferencePages((offset) => {
			const query = new URLSearchParams({
				sortBy: sort,
				offset: String(offset),
				limit: String(FAVORITE_PAGE_MAX_ENTRIES),
			});
			const request = readFavoriteQuery(query);
			return requestPreference({
				...favoriteTransport,
				method: 'GET',
				path: '/favorite-paths?' + query,
				status: 200,
				signal,

				decode: (value) => readFavoriteList(value, request),
			});
		});
		return items.map(fromFavorite);
	},

	async addFavorite(path: string, name: string | null, signal?: AbortSignal): Promise<FavoritePathSummary> {
		return requestPreference({
			...favoriteTransport,
			method: 'POST',
			path: '/favorite-paths',
			status: 201,
			signal,

			input: () => readFavoriteCreate({ path, name }),

			decode: (value) => favoriteMutation(value),
		});
	},

	async updateFavorite(
		id: number,
		expectedVersion: number,
		path: string,
		name: string | null,
		signal?: AbortSignal,
	): Promise<FavoritePathSummary> {
		return requestPreference({
			...favoriteTransport,
			method: 'PUT',
			path: '/favorite-paths/' + readFavoriteId(String(id)),
			status: 200,
			signal,

			input: () => readFavoriteUpdate({ expectedVersion, path, name }),

			decode: (value) => favoriteMutation(value, { id, version: expectedVersion }),
		});
	},

	async touchFavorite(item: FavoritePathSummary, signal?: AbortSignal): Promise<FavoritePathSummary> {
		return requestPreference({
			...favoriteTransport,
			method: 'PUT',
			path: '/favorite-paths/' + readFavoriteId(String(item.id)) + '/update-last-used',
			status: 200,
			signal,

			input: () => readFavoriteVersion({ expectedVersion: item.version }),

			decode: (value) => favoriteMutation(value, item),
		});
	},

	async removeFavorite(item: FavoritePathSummary, signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...favoriteTransport,
			method: 'DELETE',
			path: '/favorite-paths/' + readFavoriteId(String(item.id)),
			status: 200,
			signal,

			input: () => readFavoriteVersion({ expectedVersion: item.version }),

			decode: readFavoriteDelete,
		});
	},

	async listHistory(signal?: AbortSignal) {
		const entries = await listPreferencePages((offset) => {
			const query = new URLSearchParams({ offset: String(offset), limit: String(HISTORY_PAGE_MAX_ENTRIES) });
			const request = readHistoryListQuery(query);
			return requestPreference({
				...historyTransport,
				method: 'GET',
				path: '/path-history?' + query,
				status: 200,
				signal,

				decode: (value) => readPathHistoryList(value, request),
			});
		});
		return entries.map(fromPathHistory);
	},

	async addHistory(path: string, signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...historyTransport,
			method: 'POST',
			path: '/path-history',
			status: 201,
			signal,

			input: () => readPathHistoryAdd({ path }),

			decode: readHistoryAddResponse,
		});
	},

	async removeHistory(id: number, signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...historyTransport,
			method: 'DELETE',
			path: '/path-history/' + readHistoryId(String(id)),
			status: 200,
			signal,
			decode: readHistoryDeleteResponse,
		});
	},

	async clearHistory(signal?: AbortSignal): Promise<void> {
		await requestPreference({
			...historyTransport,
			method: 'DELETE',
			path: '/path-history',
			status: 200,
			signal,
			decode: readHistoryClearResponse,
		});
	},
};
