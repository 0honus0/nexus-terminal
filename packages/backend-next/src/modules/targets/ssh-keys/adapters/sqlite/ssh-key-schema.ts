import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

/** Credentials are encrypted before reaching storage; no public plaintext column. */
export async function initializeSshKeySchema(db: SqlExecutor): Promise<void> {
	await db.exec(`
    CREATE TABLE ssh_keys(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      encrypted_private_key TEXT NOT NULL,
      encrypted_passphrase TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
