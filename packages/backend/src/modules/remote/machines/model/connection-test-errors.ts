import { ConnectionTestFailure } from '../../connection-test-failure.js';
import type { RemoteHostKeyChallenge } from './machine-types.js';

export class ConnectionTestHostKeyFailure extends ConnectionTestFailure {
	constructor(
		readonly hostKey: RemoteHostKeyChallenge,
		cause: unknown,
	) {
		super('host_key_untrusted', { cause });
		this.name = 'ConnectionTestHostKeyFailure';
	}
}
