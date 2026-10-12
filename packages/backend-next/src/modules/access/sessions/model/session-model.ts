import { accessStorageBoundary } from '../../access-storage-boundary.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { SessionStorage, LoginFailureRecord } from '../storage/session-storage.js';
import type {
	IssueSessionRequest,
	SessionIdentity,
	LoginFailureState,
	LoginFailurePage,
	IssueSessionResult,
} from './session-types.js';
import type { LoginFailureLimits } from '../../login-failure-types.js';
import { mayAttemptLogin, nextLoginFailure } from '../login-failure-rules.js';

function fromLoginFailureRecord(record: LoginFailureRecord): LoginFailureState {
	return {
		attempts: record.attempts,
		windowStartedAt: record.windowStartedAt,
		blockedUntil: record.blockedUntil,
		lastAttemptAt: record.lastAttemptAt,
	};
}

export class SessionModel {
	constructor(
		private readonly storage: Readonly<SessionStorage>,
		private readonly tokens: SessionTokens,
	) {}

	async issue(input: IssueSessionRequest): Promise<IssueSessionResult> {
		const token = this.tokens.issue();
		const result = await accessStorageBoundary(() =>
			this.storage.issue({
				accountId: input.accountId,
				expectedPasswordHash: input.passwordHash,
				newTokenDigest: this.tokens.digest(token),
				rememberMe: input.rememberMe,
				expiresAt: input.expiresAt,
				source: input.source,
				clearLoginAttempts: input.clearLoginAttempts,
				signal: input.signal,
			}),
		);
		switch (result) {
			case 'issued':
				return { status: 'issued', token };
			case 'credentials_changed':
				return { status: 'credentials_changed' };
			case 'rate_limited':
				return { status: 'rate_limited' };
			case 'cancelled':
				return { status: 'cancelled' };
		}
	}

	async validate(token: string, now: number): Promise<SessionIdentity | null> {
		return this.validateDigest(this.tokens.digest(token), now);
	}

	/** Revalidate a stored session without retaining its bearer credential. */
	async validateDigest(digest: string, now: number): Promise<SessionIdentity | null> {
		const record = await accessStorageBoundary(() => this.storage.validate(digest, now));
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
		return accessStorageBoundary(() => this.storage.revoke(this.tokens.digest(token)));
	}

	async checkLoginAdmission(source: string): Promise<boolean> {
		const now = Date.now();
		const record = await accessStorageBoundary(() => this.storage.getLoginFailure(source));
		return mayAttemptLogin(record === null ? null : fromLoginFailureRecord(record), now);
	}

	async listLoginFailures(limit: number, offset: number): Promise<LoginFailurePage> {
		const page = await accessStorageBoundary(() => this.storage.listLoginFailures(limit, offset));
		return {
			total: page.total,
			entries: page.entries.map(({ source, record }) => ({
				sourceIp: source,
				attempts: record.attempts,
				lastAttemptAt: record.lastAttemptAt,
				blockedUntil: record.blockedUntil > 0 ? record.blockedUntil : null,
			})),
		};
	}

	clearLoginFailure(source: string): Promise<boolean> {
		return accessStorageBoundary(() => this.storage.clearLoginFailure(source));
	}

	recordFailedPassword(source: string, limits: LoginFailureLimits): Promise<void> {
		const now = Date.now();
		return accessStorageBoundary(() =>
			this.storage.recordFailedPassword(source, (record) => {
				const state = nextLoginFailure(record === null ? null : fromLoginFailureRecord(record), now, limits);
				return {
					attempts: state.attempts,
					windowStartedAt: state.windowStartedAt,
					blockedUntil: state.blockedUntil,
					lastAttemptAt: now,
				};
			}),
		);
	}
}
