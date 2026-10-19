export const HISTORY_KINDS = ['command', 'path'] as const;

export type HistoryKind = (typeof HISTORY_KINDS)[number];

export const HISTORY_TEXT_MAX_BYTES = 4096;

export const HISTORY_REQUEST_MAX_BYTES = 32 * 1024;

export const HISTORY_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

export const HISTORY_PAGE_MAX_ENTRIES = 100;

export const HISTORY_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
] as const;

export type HistoryErrorCode = (typeof HISTORY_ERROR_CODES)[number];
