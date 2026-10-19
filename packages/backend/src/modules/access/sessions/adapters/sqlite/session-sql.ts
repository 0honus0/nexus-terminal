import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { readAccountRow } from '../../../accounts/adapters/sqlite/account-sql.js';
import { createHash } from 'node:crypto';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	SessionStorage,
	SessionWrite,
	SessionRecord,
	LoginFailureRecord,
	SessionIssueResult,
	SessionTransactionAdmission,
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
			const row = await tx.one('SELECT * FROM access_accounts WHERE id=?', [command.accountId]);
			const account = row === null ? null : readAccountRow(row);
			if (
				account === null ||
				account.passwordHash !== command.expectedPasswordHash ||
				account.twoFactorEnabled ||
				account.passkeyRequired
			) {
				return 'credentials_changed';
			}
			const admission = command.clearLoginAttempts
				? await tx.one(
						'SELECT attempts,window_started_at,blocked_until,last_attempt_at FROM access_login_attempts WHERE source=?',
						[command.source],
					)
				: null;
			const failure = admission === null ? null : decodeLoginFailure(admission);
			const now = Date.now();
			if (failure !== null && failure.blockedUntil > now) {
				return 'rate_limited';
			}
			// HTTP cookie delivery and SQLite commit cannot be atomic. Keep existing
			// sessions valid when a new cookie cannot reach its requester.
			if (command.signal?.aborted || command.expiresAt <= now) {
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
					now,
				],
			);
			if (command.clearLoginAttempts) {
				await tx.run('DELETE FROM access_login_attempts WHERE source=?', [command.source]);
			}
			return 'issued';
		});
	}

	async validate(tokenDigest: string, now: () => number): Promise<SessionRecord | null> {
		await this.maybeSweep();
		return this.db.transaction((tx) => this.validateInTransaction(tx, tokenDigest, now));
	}

	async validateInTransaction(
		tx: SqlExecutor,
		tokenDigest: string,
		now: () => number,
	): Promise<SessionRecord | null> {
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
		const account = readAccountRow(row);
		if (typeof row.expires_at !== 'number' || !Number.isSafeInteger(row.expires_at) || row.expires_at < 0) {
			throw new Error('Corrupt session expiry');
		}
		if (typeof row.password_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(row.password_revision)) {
			throw new Error('Corrupt session credential revision');
		}
		if (row.password_revision !== credentialRevision(account.passwordHash) || row.expires_at <= now()) {
			await tx.run('DELETE FROM access_sessions WHERE token_digest=?', [tokenDigest]);
			return null;
		}
		return {
			userId: account.id,
			username: account.username,
			twoFactorEnabled: account.twoFactorEnabled,
			passkeyRequired: account.passkeyRequired,
			createdAt: account.createdAt,
			updatedAt: account.updatedAt,
			expiresAt: row.expires_at,
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
		admission: SessionTransactionAdmission,
		limit: number,
		offset: number,
	): Promise<{ entries: Array<{ source: string; record: LoginFailureRecord }>; total: number }> {
		await this.maybeSweep();
		return this.db.transaction(async (tx) => {
			admission.admit(await this.validateInTransaction(tx, admission.tokenDigest, Date.now));
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
			admission.admit(await this.validateInTransaction(tx, admission.tokenDigest, Date.now));
			return { entries, total: count.total };
		});
	}

	clearLoginFailure(source: string, admission: SessionTransactionAdmission): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			admission.admit(await this.validateInTransaction(tx, admission.tokenDigest, Date.now));
			const result = await tx.run('DELETE FROM access_login_attempts WHERE source=?', [source]);
			admission.admit(await this.validateInTransaction(tx, admission.tokenDigest, Date.now));
			return result.changes > 0;
		});
	}
}
