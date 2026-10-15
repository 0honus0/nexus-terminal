import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { createHash } from 'node:crypto';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	SessionStorage,
	SessionWrite,
	SessionRecord,
	LoginFailureRecord,
	SessionIssueResult,
} from '../../storage/session-storage.js';

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
		lastAttemptAt: integer(row.last_attempt_at),
	};
}

export class SqliteSessionStorage implements SessionStorage {
	private lastSweep = 0;
	private sweeping: Promise<void> | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	private async maybeSweep(now = Date.now()): Promise<void> {
		if (this.sweeping !== null) {
			return this.sweeping;
		}
		if (now - this.lastSweep < 5 * 60_000) {
			return;
		}
		const task = this.db
			.transaction(async (tx) => {
				await tx.run('DELETE FROM access_sessions WHERE expires_at <= ?', [now]);
				await tx.run('DELETE FROM access_login_attempts WHERE last_attempt_at < ? AND blocked_until <= ?', [
					now - 7 * 24 * 60 * 60_000,
					now,
				]);
			})
			.then(() => {
				this.lastSweep = now;
			});
		this.sweeping = task;
		try {
			await task;
		} finally {
			if (this.sweeping === task) {
				this.sweeping = null;
			}
		}
	}

	async issue(command: SessionWrite): Promise<SessionIssueResult> {
		await this.maybeSweep();
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
				return 'credentials_changed';
			}
			if (command.clearLoginAttempts) {
				const admission = await tx.one('SELECT blocked_until FROM access_login_attempts WHERE source=?', [
					command.source,
				]);
				if (admission) {
					if (
						typeof admission.blocked_until !== 'number' ||
						!Number.isSafeInteger(admission.blocked_until) ||
						admission.blocked_until < 0
					) {
						throw new Error('Corrupt login admission');
					}
					if (admission.blocked_until > Date.now()) {
						return 'rate_limited';
					}
				}
			}
			// HTTP cookie delivery and SQLite commit cannot be atomic. Keep existing
			// sessions valid when a new cookie cannot reach its requester.
			if (command.signal?.aborted) {
				return 'cancelled';
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
			return 'issued';
		});
	}

	async validate(tokenDigest: string, now: number): Promise<SessionRecord | null> {
		await this.maybeSweep(now);
		return this.db.transaction((tx) => this.validateInTransaction(tx, tokenDigest, now));
	}

	async validateInTransaction(tx: SqlExecutor, tokenDigest: string, now: number): Promise<SessionRecord | null> {
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
	}

	async revoke(tokenDigest: string): Promise<void> {
		await this.db.run('DELETE FROM access_sessions WHERE token_digest=?', [tokenDigest]);
	}

	async getLoginFailure(source: string): Promise<LoginFailureRecord | null> {
		await this.maybeSweep();
		const row = await this.db.one(
			'SELECT attempts,window_started_at,blocked_until,last_attempt_at FROM access_login_attempts WHERE source=?',
			[source],
		);
		return row === null ? null : decodeLoginFailure(row);
	}

	async recordFailedPassword(
		source: string,
		decide: (current: LoginFailureRecord | null) => LoginFailureRecord,
	): Promise<void> {
		await this.maybeSweep();
		return this.db.transaction(async (tx) => {
			const previous = await tx.one(
				'SELECT attempts,window_started_at,blocked_until,last_attempt_at FROM access_login_attempts WHERE source=?',
				[source],
			);
			const next = decide(previous === null ? null : decodeLoginFailure(previous));
			await tx.run(
				`INSERT INTO access_login_attempts(source,attempts,window_started_at,blocked_until,last_attempt_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(source) DO UPDATE SET attempts=excluded.attempts,
           window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until,
           last_attempt_at=excluded.last_attempt_at`,
				[source, next.attempts, next.windowStartedAt, next.blockedUntil, next.lastAttemptAt],
			);
		});
	}

	async listLoginFailures(
		limit: number,
		offset: number,
	): Promise<{ entries: Array<{ source: string; record: LoginFailureRecord }>; total: number }> {
		await this.maybeSweep();
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				'SELECT source,attempts,window_started_at,blocked_until,last_attempt_at FROM access_login_attempts ORDER BY last_attempt_at DESC,source LIMIT ? OFFSET ?',
				[limit, offset],
			);
			const count = await tx.one('SELECT COUNT(*) AS total FROM access_login_attempts');
			const entries = rows.map((row) => {
				if (typeof row.source !== 'string') {
					throw new Error('Corrupt login failure source');
				}
				return { source: row.source, record: decodeLoginFailure(row) };
			});
			if (!count || typeof count.total !== 'number' || !Number.isSafeInteger(count.total)) {
				throw new Error('Corrupt login failure total');
			}
			return { entries, total: count.total };
		});
	}

	async clearLoginFailure(source: string): Promise<boolean> {
		const result = await this.db.run('DELETE FROM access_login_attempts WHERE source=?', [source]);
		return result.changes > 0;
	}
}
