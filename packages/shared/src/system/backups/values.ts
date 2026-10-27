export const BACKUP_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export const BACKUP_MAX_FILE_BYTES = 100 * 1024 * 1024;

export const BACKUP_REQUEST_MAX_BYTES = 64 * 1024;

export const BACKUP_MULTIPART_MAX_BYTES = BACKUP_MAX_FILE_BYTES + BACKUP_REQUEST_MAX_BYTES;

export const BACKUP_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'invalid_password',
	'limit_exceeded',
	'source_changed',
	'unavailable',
	'busy',
	// Installed admission and listener failures precede the System handler.
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'shutting_down',
] as const;

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];
