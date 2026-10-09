import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

export async function initializeAccountSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
    CREATE TABLE access_accounts (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0 CHECK(two_factor_enabled IN (0,1)),
      passkey_required INTEGER NOT NULL DEFAULT 0 CHECK(passkey_required IN (0,1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
