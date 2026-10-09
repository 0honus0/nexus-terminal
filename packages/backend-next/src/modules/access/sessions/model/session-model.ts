import { createHash, randomBytes } from 'node:crypto';
import type { SessionStorage } from '../storage/session-storage.js';
import type { SessionIdentity } from './session-types.js';

export class SessionModel {
	constructor(private readonly storage: Readonly<SessionStorage>) {}

	static digest(token: string): string {
		return createHash('sha256').update(token, 'utf8').digest('hex');
	}

	static newToken(): string {
		return randomBytes(32).toString('base64url');
	}

	async issue(input: {
		accountId: number;
		passwordHash: string;
		previousToken: string | null;
		rememberMe: boolean;
		expiresAt: number;
		source: string;
	}): Promise<string | null> {
		const token = SessionModel.newToken();
		const success = await this.storage.issue({
			accountId: input.accountId,
			expectedPasswordHash: input.passwordHash,
			previousTokenDigest: input.previousToken === null ? null : SessionModel.digest(input.previousToken),
			newTokenDigest: SessionModel.digest(token),
			rememberMe: input.rememberMe,
			expiresAt: input.expiresAt,
			source: input.source,
		});
		return success ? token : null;
	}

	async validate(token: string, now: number): Promise<SessionIdentity | null> {
		const record = await this.storage.validate(SessionModel.digest(token), now);
		if (record === null) {
			return null;
		}
		return {
			account: {
				id: record.userId,
				username: record.username,
				twoFactorEnabled: record.twoFactorEnabled,
				passkeyRequired: record.passkeyRequired,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			},
			expiresAt: record.expiresAt,
		};
	}

	revoke(token: string): Promise<void> {
		return this.storage.revoke(SessionModel.digest(token));
	}

	checkLoginAdmission(source: string): Promise<boolean> {
		return this.storage.checkLoginAdmission(source, Date.now());
	}

	recordFailedPassword(source: string): Promise<void> {
		return this.storage.recordFailedPassword(source, Date.now());
	}
}
