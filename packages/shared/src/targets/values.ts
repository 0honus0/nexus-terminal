/** Known public Targets error codes; backend diagnostics and secrets never cross wire. */
export const TARGET_ERROR_CODES = [
	'invalid_input',
	'reference_not_found',
	'reference_in_use',
	'conflict',
	'unresolvable',
	'storage_unavailable',
	'internal_failure',
] as const;

export type TargetErrorCode = (typeof TARGET_ERROR_CODES)[number];

export type TargetHttpErrorCode =
	TargetErrorCode | 'unauthenticated' | 'forbidden' | 'not_found' | 'version_conflict' | 'body_too_large';

/** Complete UTF-8 JSON budgets, including envelopes and escaped field contents. */
export const TARGET_HTTP_BODY_LIMITS = {
	connections: 128 * 1024,
	proxies: 64 * 1024,
	'ssh-keys': 128 * 1024,
	tags: 16 * 1024,
	'host-keys': 16 * 1024,
} as const;
