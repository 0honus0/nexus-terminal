import { RemoteSessionFailure } from './session-failure.js';

/** Raised only when the SSH verifier explicitly rejects a presented key. */
export class RemoteHostKeyUntrustedError extends RemoteSessionFailure {
	constructor(cause: unknown) {
		super('host_key_untrusted', { cause });
	}
}
