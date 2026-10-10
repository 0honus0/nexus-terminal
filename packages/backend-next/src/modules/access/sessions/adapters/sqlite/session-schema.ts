import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeSessionSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
    CREATE TABLE access_sessions (
      token_digest TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
      password_revision TEXT NOT NULL,
      remember_me INTEGER NOT NULL CHECK(remember_me IN (0,1)),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_access_sessions_user ON access_sessions(user_id);
    CREATE INDEX idx_access_sessions_expiry ON access_sessions(expires_at);
    CREATE TABLE access_login_attempts (
      source TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL CHECK(attempts >= 0),
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL
    );
  `);
}
