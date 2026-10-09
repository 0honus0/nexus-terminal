import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

/** Connection auth is orthogonal to target metadata and references an SSH key. */
export async function initializeConnectionCredentialSchema(db: SqlExecutor): Promise<void> {
	await db.exec(`
    CREATE TABLE connection_credentials(
      connection_id INTEGER PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
      auth_method TEXT NOT NULL CHECK(auth_method IN ('password','ssh_key')),
      encrypted_password TEXT,
      ssh_key_id INTEGER REFERENCES ssh_keys(id) ON DELETE RESTRICT,
      updated_at INTEGER NOT NULL,
      CHECK (
        (auth_method='password' AND encrypted_password IS NOT NULL AND ssh_key_id IS NULL) OR
        (auth_method='ssh_key' AND encrypted_password IS NULL AND ssh_key_id IS NOT NULL)
      )
    );
    CREATE INDEX idx_connection_credentials_key ON connection_credentials(ssh_key_id);
  `);
}
