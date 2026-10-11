export const OBSERVATION_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'limit_exceeded',
	'conflict',
	'remote_unavailable',
	'command_failed',
	'operation_unknown',
	'host_key_untrusted',
] as const;

export type ObservationErrorCode = (typeof OBSERVATION_ERROR_CODES)[number];

export const OBSERVATION_MAX_RESPONSE_BYTES = 512 * 1024;

export const OBSERVATION_MAX_TEXT_BYTES = 64 * 1024;

export const OBSERVATION_MAX_RESOURCES = 10000;
