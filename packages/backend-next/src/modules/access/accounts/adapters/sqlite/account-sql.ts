import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { AccountStorage, AccountRecord, CreateInitialAdminRecord } from '../../storage/account-storage.js';

function decodeAccount(row: Record<string, unknown>): AccountRecord {
	const numeric = (value: unknown): number => {
		if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
			throw new Error('Invalid stored account');
		}
		return value;
	};

	if (typeof row.username !== 'string' || typeof row.password_hash !== 'string') {
		throw new Error('Invalid stored account');
	}
	const twoFactor = numeric(row.two_factor_enabled);
	const passkey = numeric(row.passkey_required);
	if (![0, 1].includes(twoFactor) || ![0, 1].includes(passkey)) {
		throw new Error('Invalid authentication factors');
	}
	return {
		id: numeric(row.id),
		username: row.username,
		passwordHash: row.password_hash,
		twoFactorEnabled: twoFactor === 1,
		passkeyRequired: passkey === 1,
		createdAt: numeric(row.created_at),
		updatedAt: numeric(row.updated_at),
	};
}

async function getAccount(tx: SqlExecutor, sql: string, value: string | number): Promise<AccountRecord | null> {
	const row = await tx.one(sql, [value]);
	return row ? decodeAccount(row) : null;
}

export class SqliteAccountStorage implements AccountStorage {
	constructor(private readonly db: SqliteRuntime) {}

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

	updatePasswordAndRevoke(userId: number, expectedHash: string, newHash: string): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const update = await tx.run(
				'UPDATE access_accounts SET password_hash=?,updated_at=? WHERE id=? AND password_hash=?',
				[newHash, Date.now(), userId, expectedHash],
			);
			if (update.changes !== 1) {
				return false;
			}
			await tx.run('DELETE FROM access_sessions WHERE user_id=?', [userId]);
			return true;
		});
	}
}
