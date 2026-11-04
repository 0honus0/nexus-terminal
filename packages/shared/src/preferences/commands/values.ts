export const COMMAND_SORTS = ['name', 'usageCount'] as const;

export type CommandSort = (typeof COMMAND_SORTS)[number];

export const COMMAND_TEXT_MAX_BYTES = 16 * 1024;

export const COMMAND_NAME_MAX_BYTES = 256;

export const COMMAND_MAX_TAGS = 50;

export const COMMAND_MAX_VARIABLES = 32;

export const COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;

export const COMMAND_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

export const COMMAND_PAGE_MAX_ENTRIES = 50;

export const COMMAND_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'version_conflict',
	'name_conflict',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export const COMMAND_VARIABLE_MAX_BYTES = 4096;

export const COMMAND_BATCH_MAX_ENTRIES = 1000;
