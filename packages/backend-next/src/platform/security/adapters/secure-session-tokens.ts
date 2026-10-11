import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokens } from '../session-tokens.js';

/** Cryptographic adapter; no knowledge of accounts or session lifecycles. */
export class SecureSessionTokens implements SessionTokens {
	issue(): string {
		return randomBytes(32).toString('base64url');
	}

	digest(token: string): string {
		return createHash('sha256').update(token, 'utf8').digest('hex');
	}
}
