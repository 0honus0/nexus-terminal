import { createHash } from 'node:crypto';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SessionStorage, SessionWrite, SessionRecord, LoginFailureRecord } from '../../storage/session-storage.js';

// TODO(Access later network-policy batch): configurable IP allow/deny policies
// and CAPTCHA require their own stored settings and real enforcement paths.

function credentialRevision(passwordHash: string): string {
	return createHash('sha256').update(passwordHash).digest('hex');
}

function decodeLoginFailure(row: Record<string, unknown>): LoginFailureRecord {
	function integer(value: unknown): number {
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
			throw new Error('Corrupt login failure counter');
		}
		return value;
	}

	return {
		attempts: integer(row.attempts),
		windowStartedAt: integer(row.window_started_at),
		blockedUntil: integer(row.blocked_until),
	};
}

export class SqliteSessionStorage implements SessionStorage {
	constructor(private readonly db: SqliteRuntime) {}

	issue(command: SessionWrite): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT password_hash,two_factor_enabled,passkey_required FROM access_accounts WHERE id=?',
				[command.accountId],
			);
			if (
				!row ||
				row.password_hash !== command.expectedPasswordHash ||
				row.two_factor_enabled !== 0 ||
				row.passkey_required !== 0
			) {
				return false;
			}
			// Session rotation and account factor recheck are one transaction.
			if (command.previousTokenDigest !== null) {
				await tx.run('DELETE FROM access_sessions WHERE token_digest=?', [command.previousTokenDigest]);
			}
			await tx.run(
				'INSERT INTO access_sessions(token_digest,user_id,password_revision,remember_me,expires_at,created_at) VALUES(?,?,?,?,?,?)',
				[
					command.newTokenDigest,
					command.accountId,
					credentialRevision(command.expectedPasswordHash),
					command.rememberMe ? 1 : 0,
					command.expiresAt,
					Date.now(),
				],
			);
			if (command.clearLoginAttempts) {
				await tx.run('DELETE FROM access_login_attempts WHERE source=?', [command.source]);
			}
			return true;
		});
	}

	validate(tokenDigest: string, now: number): Promise<SessionRecord | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				`SELECT s.expires_at,s.password_revision,a.id,a.username,a.password_hash,
                a.two_factor_enabled,a.passkey_required,a.created_at,a.updated_at
         FROM access_sessions s JOIN access_accounts a ON a.id=s.user_id
         WHERE s.token_digest=?`,
				[tokenDigest],
			);
			if (!row) {
				return null;
			}
			if (
				typeof row.password_hash !== 'string' ||
				row.password_revision !== credentialRevision(row.password_hash) ||
				typeof row.expires_at !== 'number' ||
				row.expires_at <= now ||
				(row.two_factor_enabled !== 0 && row.two_factor_enabled !== 1) ||
				(row.passkey_required !== 0 && row.passkey_required !== 1)
			) {
				await tx.run('DELETE FROM access_sessions WHERE token_digest=?', [tokenDigest]);
				return null;
			}

			const number = (value: unknown): number => {
				if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
					throw new Error('Corrupt session account');
				}
				return value;
			};

			if (typeof row.username !== 'string') {
				throw new Error('Corrupt session username');
			}
			return {
				userId: number(row.id),
				username: row.username,
				twoFactorEnabled: row.two_factor_enabled === 1,
				passkeyRequired: row.passkey_required === 1,
				createdAt: number(row.created_at),
				updatedAt: number(row.updated_at),
				expiresAt: number(row.expires_at),
			};
		});
	}

	async revoke(tokenDigest: string): Promise<void> {
		await this.db.run('DELETE FROM access_sessions WHERE token_digest=?', [tokenDigest]);
	}

	async getLoginFailure(source: string): Promise<LoginFailureRecord | null> {
		const row = await this.db.one(
			'SELECT attempts,window_started_at,blocked_until FROM access_login_attempts WHERE source=?',
			[source],
		);
		return row === null ? null : decodeLoginFailure(row);
	}

	recordFailedPassword(
		source: string,
		decide: (current: LoginFailureRecord | null) => LoginFailureRecord,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			const previous = await tx.one(
				'SELECT attempts,window_started_at,blocked_until FROM access_login_attempts WHERE source=?',
				[source],
			);
			const next = decide(previous === null ? null : decodeLoginFailure(previous));
			await tx.run(
				`INSERT INTO access_login_attempts(source,attempts,window_started_at,blocked_until)
         VALUES(?,?,?,?)
         ON CONFLICT(source) DO UPDATE SET attempts=excluded.attempts,
           window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until`,
				[source, next.attempts, next.windowStartedAt, next.blockedUntil],
			);
		});
	}
}
