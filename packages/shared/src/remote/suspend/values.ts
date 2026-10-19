/** Raw UTF-8 snapshot and its complete JSON envelope use different budgets. */
export const WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export const WORKSPACE_SUSPEND_MAX_JSON_BYTES = WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES * 6 + 16 * 1024;

export const WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES = 256 * 1024;

export const WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS = 128;

export const SUSPENDED_SESSION_STATUSES = ['active', 'disconnected'] as const;

export type SuspendedSessionStatus = (typeof SUSPENDED_SESSION_STATUSES)[number];

export const SUSPENDED_OWNERSHIP_STATES = ['available', 'resuming', 'attached'] as const;

export type SuspendedOwnershipState = (typeof SUSPENDED_OWNERSHIP_STATES)[number];

export const SUSPENDED_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

/** Full catalog envelope, independent of private task admission quotas. */
export const SUSPENDED_CATALOG_MAX_ENTRIES = 64;

export const SUSPENDED_CATALOG_MAX_JSON_BYTES = 1024 * 1024;

export const SUSPENDED_MANAGEMENT_MAX_JSON_BYTES = 4096;

export const SUSPENDED_HTTP_ERROR_CODES = [
	'invalid_input',
	'invalid_body',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
	'limit_exceeded',
	'operation_unknown',
	'remote_unavailable',
	'request_timeout',
	'invalid_json',
	'body_too_large',
	'unsupported_media_type',
	'csrf_rejected',
	'invalid_host',
	'invalid_path',
	'internal_failure',
] as const;

export type SuspendedHttpErrorCode = (typeof SUSPENDED_HTTP_ERROR_CODES)[number];

export function suspendedHttpErrorStatus(code: SuspendedHttpErrorCode): number {
	switch (code) {
		case 'invalid_input':
		case 'invalid_body':
		case 'invalid_json':
		case 'invalid_path':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
		case 'csrf_rejected':
		case 'invalid_host':
			return 403;
		case 'not_found':
			return 404;
		case 'conflict':
			return 409;
		case 'limit_exceeded':
			return 429;
		case 'body_too_large':
			return 413;
		case 'unsupported_media_type':
			return 415;
		case 'internal_failure':
			return 500;
		case 'request_timeout':
			return 408;
		default:
			return 503;
	}
}

/** Rendered UTF-8 download budget; the private raw-history disk window is separate. */
export const SUSPENDED_LOG_MAX_BYTES = 128 * 1024 * 1024;

export const SUSPENDED_REVOCATION_REASONS = ['takeover', 'lease_expired'] as const;

export type SuspendedRevocationReason = (typeof SUSPENDED_REVOCATION_REASONS)[number];

export const SUSPENDED_TERMINATION_REASONS = ['retention_expired'] as const;

export type SuspendedTerminationReason = (typeof SUSPENDED_TERMINATION_REASONS)[number];
