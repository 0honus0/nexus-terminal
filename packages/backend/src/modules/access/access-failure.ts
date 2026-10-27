/** Internal application failure; independent of Service and public error mapping. */
export class AccessFailure extends Error {
	constructor(
		readonly code:
			| 'invalid_input'
			| 'already_initialized'
			| 'invalid_credentials'
			| 'factor_unavailable'
			| 'limit_exceeded'
			| 'challenge_expired'
			| 'not_found'
			| 'conflict'
			| 'forbidden'
			| 'captcha_unavailable'
			| 'operation_unknown'
			| 'unauthenticated'
			| 'storage_unavailable'
			| 'internal_failure',
		options?: ErrorOptions,
	) {
		super('Access: ' + code, options);
		this.name = 'AccessFailure';
	}
}
