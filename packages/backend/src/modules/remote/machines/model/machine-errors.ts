/** A presented SSH host key was explicitly rejected; no trust-on-first-use fallback. */
export class RemoteHostKeyUntrustedError extends Error {
	constructor(cause: unknown) {
		super('Remote SSH host key not trusted', { cause });
		this.name = 'RemoteHostKeyUntrustedError';
	}
}
