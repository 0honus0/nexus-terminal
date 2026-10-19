import type { CredentialConfirmation } from '../../storage/account-storage.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	AccountStorage,
	AccountRecord,
	CreateInitialAdminRecord,
	PasswordUpdateRecord,
} from '../../storage/account-storage.js';

export function readAccountRow(row: Record<string, unknown>): AccountRecord {
	const numeric = (value: unknown, min = 1): number => {
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
			throw new Error('Invalid stored account');
		}
		return value;
	};

	if (
		typeof row.username !== 'string' ||
		!row.username.trim() ||
		Buffer.from(row.username, 'utf8').toString('utf8') !== row.username ||
		typeof row.password_hash !== 'string' ||
		!row.password_hash
	) {
		throw new Error('Invalid stored account');
	}
	const twoFactor = numeric(row.two_factor_enabled, 0);
	const passkey = numeric(row.passkey_required, 0);
	if (![0, 1].includes(twoFactor) || ![0, 1].includes(passkey)) {
		throw new Error('Invalid authentication factors');
	}
	return {
		id: numeric(row.id),
		username: row.username,
		passwordHash: row.password_hash,
		twoFactorEnabled: twoFactor === 1,
		passkeyRequired: passkey === 1,
		createdAt: numeric(row.created_at, 0),
		updatedAt: numeric(row.updated_at, 0),
	};
}

async function getAccount(tx: SqlExecutor, sql: string, value: string | number): Promise<AccountRecord | null> {
	const row = await tx.one(sql, [value]);
	return row ? readAccountRow(row) : null;
}

export class SqliteAccountStorage implements AccountStorage {
	constructor(private readonly db: SqliteRuntime) {}

	confirmCredential(input: CredentialConfirmation): Promise<boolean> {
		return this.db.transaction(
			async (tx) =>
				(await tx.one(
					'SELECT 1 FROM access_accounts a JOIN access_sessions s ON s.user_id=a.id WHERE a.id=? AND a.password_hash=? AND s.token_digest=? AND s.expires_at>?',
					[input.userId, input.passwordHash, input.sessionDigest, input.now()],
				)) !== null,
		);
	}

	needsSetup(): Promise<boolean> {
		return this.db.one('SELECT 1 AS present FROM access_accounts LIMIT 1').then((row) => row === null);
	}

	findByUsername(username: string): Promise<AccountRecord | null> {
		return getAccount(this.db, 'SELECT * FROM access_accounts WHERE username=?', username);
	}

	findById(id: number): Promise<AccountRecord | null> {
		return getAccount(this.db, 'SELECT * FROM access_accounts WHERE id=?', id);
	}

	createInitialAdmin(command: CreateInitialAdminRecord): Promise<AccountRecord | null> {
		return this.db.transaction(async (tx) => {
			const existing = await tx.one('SELECT 1 AS present FROM access_accounts LIMIT 1');
			if (existing !== null) {
				return null;
			}
			const now = Date.now();
			const result = await tx.run(
				'INSERT INTO access_accounts(username,password_hash,created_at,updated_at) VALUES(?,?,?,?)',
				[command.username, command.passwordHash, now, now],
			);
			return getAccount(tx, 'SELECT * FROM access_accounts WHERE id=?', result.lastId);
		});
	}

	updatePasswordAndRevoke(command: PasswordUpdateRecord): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const update = await tx.run(
				`UPDATE access_accounts SET password_hash=?,updated_at=? WHERE id=? AND password_hash=?
 AND EXISTS (SELECT 1 FROM access_sessions WHERE token_digest=?
  AND user_id=access_accounts.id AND expires_at>?)`,
				[command.newHash, Date.now(), command.userId, command.expectedHash, command.sessionDigest, Date.now()],
			);
			if (update.changes !== 1) {
				return false;
			}
			await tx.run('UPDATE access_password_epoch SET revision=revision+1 WHERE id=1');
			await tx.run('DELETE FROM access_sessions WHERE user_id=?', [command.userId]);
			return true;
		});
	}
}
