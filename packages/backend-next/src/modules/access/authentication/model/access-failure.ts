/** Internal application failure; independent of Service and public error mapping. */
export class AccessFailure extends Error {
	constructor(readonly code: 'invalid_input' | 'already_initialized' | 'invalid_credentials' | 'conflict') {
		super('Access: ' + code);
		this.name = 'AccessFailure';
	}
}
