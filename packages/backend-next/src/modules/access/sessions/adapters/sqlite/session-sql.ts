import { createHash } from 'node:crypto';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	SessionStorage,
	SessionWrite,
	SessionRecord,
	FailureCounterCommand,
} from '../../storage/session-storage.js';

// TODO(Access later network-policy batch): configurable IP allow/deny policies
// and CAPTCHA require their own stored settings and real enforcement paths.

function credentialRevision(passwordHash: string): string {
	return createHash('sha256').update(passwordHash).digest('hex');
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

	async checkLoginAdmission(source: string, now: number): Promise<boolean> {
		const row = await this.db.one(
			'SELECT attempts,window_started_at,blocked_until FROM access_login_attempts WHERE source=?',
			[source],
		);
		if (!row) {
			return true;
		}
		return typeof row.blocked_until === 'number' && row.blocked_until <= now;
	}

	async recordFailedPassword(command: FailureCounterCommand): Promise<void> {
		await this.db.transaction(async (tx) => {
			const previous = await tx.one(
				'SELECT attempts,window_started_at,blocked_until FROM access_login_attempts WHERE source=?',
				[command.source],
			);
			const existingBlock = typeof previous?.blocked_until === 'number' ? previous.blocked_until : 0;
			const activeBlock = existingBlock > command.now;
			const expiredBlock = existingBlock > 0 && existingBlock <= command.now;
			const currentWindow =
				previous &&
				typeof previous.window_started_at === 'number' &&
				!expiredBlock &&
				command.now - previous.window_started_at < command.windowMs;
			const attempts = currentWindow && typeof previous.attempts === 'number' ? previous.attempts + 1 : 1;
			const windowStart = currentWindow ? (previous.window_started_at as number) : command.now;
			const blockedUntil = activeBlock
				? existingBlock
				: attempts >= command.maxAttempts
					? command.now + command.banMs
					: 0;
			await tx.run(
				`INSERT INTO access_login_attempts(source,attempts,window_started_at,blocked_until)
         VALUES(?,?,?,?)
         ON CONFLICT(source) DO UPDATE SET attempts=excluded.attempts,
           window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until`,
				[command.source, attempts, windowStart, blockedUntil],
			);
		});
	}
}
