export const SYSTEM_STATUS_ERROR_CODES = [
	'unauthenticated',
	'forbidden',
	'remote_unavailable',
	'invalid_input',
] as const;

export type SystemStatusErrorCode = (typeof SYSTEM_STATUS_ERROR_CODES)[number];

export const SYSTEM_STATUS_MAX_RESPONSE_BYTES = 16 * 1024;
