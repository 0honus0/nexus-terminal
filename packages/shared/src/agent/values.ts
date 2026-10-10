export const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const AGENT_OPERATION_ERROR_CODES = [
	'invalid_input',
	'not_found',
	'active_run_conflict',
	'idempotency_conflict',
	'version_conflict',
	'storage_unavailable',
	'internal_failure',
] as const;

export type AgentOperationErrorCode = (typeof AGENT_OPERATION_ERROR_CODES)[number];

export const AGENT_HTTP_ERROR_CODES = [
	...AGENT_OPERATION_ERROR_CODES,
	'unauthenticated',
	'forbidden',
	'invalid_json',
	'body_too_large',
	'unsupported_media_type',
	'invalid_host',
	'csrf_rejected',
	'invalid_path',
	'shutting_down',
] as const;

export type AgentHttpErrorCode = (typeof AGENT_HTTP_ERROR_CODES)[number];

export const AGENT_MAX_JSON_BODY_BYTES = 16 * 1024;

/** 100 events at under 224 encoded bytes each, plus envelope; all other responses are smaller. */
export const AGENT_MAX_RESPONSE_BYTES = 32 * 1024;
