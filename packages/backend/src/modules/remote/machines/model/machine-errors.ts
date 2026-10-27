import type { RemoteHostKeyChallenge } from './machine-types.js';

/** A presented SSH host key was explicitly rejected; no trust-on-first-use fallback. */
export class RemoteHostKeyUntrustedError extends Error {
	constructor(
		readonly hostKey: RemoteHostKeyChallenge,
		cause: unknown,
	) {
		super('Remote SSH host key not trusted', { cause });
		this.name = 'RemoteHostKeyUntrustedError';
	}
}
