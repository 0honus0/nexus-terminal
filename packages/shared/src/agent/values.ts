export const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const AGENT_OPERATION_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'app_disabled',
	'execution_disabled',
	'capability_undeclared',
	'target_denied',
	'not_found',
	'active_run_conflict',
	'idempotency_conflict',
	'approval_stale',
	'version_conflict',
	'storage_unavailable',
	'internal_failure',
	'provider_unavailable',
	'provider_in_use',
	'provider_configuration_stale',
	'model_not_found',
	'provider_request_failed',
	'limit_exceeded',
	'operation_unknown',
] as const;

export type AgentOperationErrorCode = (typeof AGENT_OPERATION_ERROR_CODES)[number];

export const AGENT_HTTP_ERROR_CODES = [
	...AGENT_OPERATION_ERROR_CODES,
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

/** Individual state / Run event budget. Scope, governance and Provider collections own separate budgets. */
export const AGENT_MAX_RESPONSE_BYTES = 32 * 1024;
