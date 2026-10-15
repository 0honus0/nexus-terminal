export const FAVORITE_PATH_SORTS = ['name', 'lastUsedAt'] as const;

export type FavoritePathSort = (typeof FAVORITE_PATH_SORTS)[number];

export const FAVORITE_PATH_MAX_BYTES = 4096;

export const FAVORITE_NAME_MAX_BYTES = 256;

export const FAVORITE_REQUEST_MAX_BYTES = 32 * 1024;

export const FAVORITE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

export const FAVORITE_PAGE_MAX_ENTRIES = 100;

export const FAVORITE_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'version_conflict',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
] as const;

export type FavoriteErrorCode = (typeof FAVORITE_ERROR_CODES)[number];
