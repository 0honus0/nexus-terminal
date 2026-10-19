/** User-visible budgets shared by the Remote Files HTTP producer and consumer. */
export const REMOTE_FILE_MAX_PATH_BYTES = 4096;

export const REMOTE_FILE_MAX_REQUEST_BYTES = 16 * 1024;

/** Formal editor text capacity. JSON budgets below also cover escaping overhead. */
export const REMOTE_FILE_MAX_TEXT_BYTES = 16 * 1024 * 1024;

export const REMOTE_FILE_MAX_WRITE_REQUEST_BYTES =
	2 * REMOTE_FILE_MAX_TEXT_BYTES + 2 * REMOTE_FILE_MAX_PATH_BYTES + 1024;

export const REMOTE_FILE_MAX_LIST_ENTRIES = 200;

export const REMOTE_FILE_MAX_METADATA_BYTES = 48 * 1024;

export const REMOTE_FILE_MAX_RESPONSE_BYTES = 2 * REMOTE_FILE_MAX_TEXT_BYTES + 4096;

export const REMOTE_FILE_ERROR_CODES = [
	'invalid_json',
	'invalid_path',
	'invalid_host',
	'body_too_large',
	'unsupported_media_type',
	'csrf_rejected',
	'internal_failure',
	'shutting_down',
	'unauthenticated',
	'forbidden',
	'not_found',
	'invalid_input',
	'stale_target',
	'host_key_untrusted',
	'limit_exceeded',
	'not_text',
	'conflict',
	'operation_unknown',
	'remote_unavailable',
] as const;

export type RemoteFileErrorCode = (typeof REMOTE_FILE_ERROR_CODES)[number];

export type RemoteFileKind = 'file' | 'directory' | 'symlink' | 'other';

export const WORKSPACE_FILES_MAX_BINARY_READS = 4;

export const WORKSPACE_FILES_MAX_BINARY_READ_BYTES = 64 * 1024 * 1024;

export const WORKSPACE_FILES_MAX_LIST_ENTRIES = 20_000;

export const WORKSPACE_FILES_MAX_SEARCH_ENTRIES = 500;

export type RemoteFileWriteStatus = 'created' | 'replaced';

export type RemoteFileTargetType = 'file' | 'directory' | 'other';
