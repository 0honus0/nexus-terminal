/** Known public Targets error codes; backend diagnostics and secrets never cross wire. */
export const TARGET_ERROR_CODES = [
	'unauthenticated',
	'forbidden',
	'invalid_input',
	'reference_not_found',
	'reference_in_use',
	'conflict',
	'unresolvable',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
] as const;

export type TargetErrorCode = (typeof TARGET_ERROR_CODES)[number];

export type TargetHttpErrorCode =
	TargetErrorCode | 'not_found' | 'version_conflict' | 'body_too_large' | 'request_timeout' | 'limit_exceeded';

/** Complete management collection responses; oversize collections fail without truncation. */
export const TARGET_MANAGEMENT_RESPONSE_MAX_BYTES = {
	// 10,368 text bytes × six-byte JSON escapes, plus IDs/relations/envelopes, for 10,000 records.
	connections: 640 * 1024 * 1024,
	proxies: 64 * 1024 * 1024,
	'ssh-keys': 16 * 1024 * 1024,
	tags: 16 * 1024 * 1024,
	'host-keys': 16 * 1024 * 1024,
} as const;

export const TARGET_MANAGEMENT_MAX_ITEMS = 10_000;

/** Complete UTF-8 JSON budgets, including envelopes and escaped field contents. */
export const TARGET_HTTP_BODY_LIMITS = {
	connections: 128 * 1024,
	proxies: 64 * 1024,
	'ssh-keys': 128 * 1024,
	tags: 16 * 1024,
	'host-keys': 16 * 1024,
} as const;
