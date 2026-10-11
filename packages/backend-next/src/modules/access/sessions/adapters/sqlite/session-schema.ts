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

/** v5 extension for the existing v1–v4 database; do not rewrite v1 history. */
export async function extendSessionLoginFailureSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec('ALTER TABLE access_login_attempts ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0;');
	await tx.run('UPDATE access_login_attempts SET last_attempt_at=window_started_at WHERE last_attempt_at=0;');
	await tx.exec('CREATE INDEX idx_access_login_attempts_last ON access_login_attempts(last_attempt_at);');
}
