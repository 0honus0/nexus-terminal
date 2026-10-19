/** All Workspace subprotocols share one envelope and NXW1 transport budget. */
export const WORKSPACE_MAX_JSON_MESSAGE_BYTES = 1024 * 1024;

export const WORKSPACE_MAX_IN_FLIGHT_REQUESTS = 64;

export const WORKSPACE_BINARY_MAX_REQUEST_ID_BYTES = 128;

export const WORKSPACE_BINARY_MAX_PAYLOAD_BYTES = 256 * 1024;

export const WORKSPACE_BINARY_PROTOCOL_VERSION = 1 as const;

export const WORKSPACE_TERMINAL_MAX_COLUMNS = 1000;

export const WORKSPACE_TERMINAL_MAX_ROWS = 500;

export const WORKSPACE_TERMINAL_MAX_INPUT_BYTES = 256 * 1024;

export const WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES = 1024 * 1024;

export const WORKSPACE_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
	'limit_exceeded',
	'host_key_untrusted',
	'operation_unknown',
	'remote_unavailable',
	'command_failed',
	'stale_target',
	'not_text',
] as const;

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];
