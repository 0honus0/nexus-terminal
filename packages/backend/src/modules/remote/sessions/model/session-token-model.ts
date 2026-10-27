import { timingSafeEqual } from 'node:crypto';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { RemoteSessionFailure } from './session-failure.js';

/** Session bearer representation stays behind the application Model boundary. */
export class SessionTokenModel {
	constructor(private readonly tokens: SessionTokens) {}

	issue(): string {
		try {
			return this.tokens.issue();
		} catch (cause) {
			throw new RemoteSessionFailure('remote_unavailable', { cause });
		}
	}

	digest(token: string): string {
		try {
			return this.tokens.digest(token);
		} catch (cause) {
			throw new RemoteSessionFailure('remote_unavailable', { cause });
		}
	}

	matches(token: string, expected: string): boolean {
		const actual = Buffer.from(this.digest(token), 'hex');
		const digest = Buffer.from(expected, 'hex');
		return actual.length === digest.length && timingSafeEqual(actual, digest);
	}
}
