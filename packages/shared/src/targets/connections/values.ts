import { TARGET_ERROR_CODES } from '../values.js';

export const CONNECTION_TYPES = ['SSH', 'RDP', 'VNC'] as const;

export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_ROUTES = ['direct', 'proxy', 'jump'] as const;

export type ConnectionRoute = (typeof CONNECTION_ROUTES)[number];

export const TARGET_CONNECTION_IMPORT_MAX_ITEMS = 50;

export const TARGET_CONNECTION_IMPORT_FILE_FIELD = 'connectionsFile';

export const TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES = 1024 * 1024;

export const TARGET_CONNECTION_IMPORT_MULTIPART_MAX_BYTES = TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES + 16 * 1024;

export const CONNECTION_TEST_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'reference_not_found',
	'unresolvable',
	'conflict',
	'host_key_untrusted',
	'connection_failed',
	'cleanup_failed',
	'limit_exceeded',
	'unavailable',
	'shutting_down',
	'storage_unavailable',
	'internal_failure',
] as const;

export type ConnectionTestErrorCode = (typeof CONNECTION_TEST_ERROR_CODES)[number];

export const CONNECTION_TEST_BODY_MAX_BYTES = 512 * 1024;

/** Maximum membership represented by connection requests and read views. */
export const TARGET_CONNECTION_MAX_TAGS = 64;

/** Authentication loss ends the whole import, rather than becoming an item result. */
export const TARGET_IMPORT_ERROR_CODES = TARGET_ERROR_CODES.filter(
	(code) => code !== 'unauthenticated' && code !== 'forbidden',
);

export type TargetImportErrorCode = (typeof TARGET_IMPORT_ERROR_CODES)[number];

export const TARGET_CONNECTION_NAME_MAX_BYTES = 128;

export const TARGET_CONNECTION_HOST_MAX_BYTES = 512;

export const TARGET_CONNECTION_USERNAME_MAX_BYTES = 256;

export const TARGET_CONNECTION_NOTES_MAX_BYTES = 4096;

export const TARGET_CONNECTION_PASSWORD_MAX_BYTES = 8192;

/** Immediate saved/draft jump references, distinct from recursive expansion depth. */
export const TARGET_CONNECTION_MAX_JUMPS = 16;
