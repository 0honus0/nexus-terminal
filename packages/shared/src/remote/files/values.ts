/** Actual product budgets shared by the independent Remote files client and server. */
export const REMOTE_FILE_MAX_PATH_BYTES = 4096;
export const REMOTE_FILE_MAX_LIST_ENTRIES = 200;
export const REMOTE_FILE_MAX_METADATA_BYTES = 48 * 1024;
export const REMOTE_FILE_MAX_TEXT_BYTES = 16 * 1024;
export const REMOTE_FILE_MAX_RESPONSE_BYTES = 128 * 1024;
export const REMOTE_FILE_MAX_RESOURCES = 8;
export const REMOTE_FILE_IDLE_MS = 2 * 60 * 1000;
export const REMOTE_FILE_OPERATION_MS = 30 * 1000;
export type RemoteFileErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' |
	'invalid_input' | 'stale_target' | 'host_key_untrusted' | 'limit_exceeded' | 'not_text' | 'remote_unavailable';
