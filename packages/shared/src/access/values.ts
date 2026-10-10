/** Stable authentication error values consumed by both endpoints. */
export type AccessHttpErrorCode =
	| 'invalid_input'
	| 'already_initialized'
	| 'invalid_credentials'
	| 'rate_limited'
	| 'factor_unavailable'
	| 'conflict'
	| 'storage_unavailable'
	| 'internal_failure'
	| 'unauthenticated'
	| 'forbidden';
