import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Factor tables belong to the first-release schema. */
export async function initializeAccessFactors(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE access_password_epoch (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
		INSERT INTO access_password_epoch(id,revision) VALUES(1,0);
		CREATE TABLE access_pending_logins (
			token_digest TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
			password_revision TEXT NOT NULL,
			remember_me INTEGER NOT NULL CHECK (remember_me IN (0,1)),
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX idx_access_pending_expiry ON access_pending_logins(expires_at);
		CREATE TABLE access_factor_challenges (
			token_digest TEXT PRIMARY KEY,
			kind TEXT NOT NULL CHECK (kind IN ('totp_setup','passkey_registration','passkey_authentication')),
			user_id INTEGER REFERENCES access_accounts(id) ON DELETE CASCADE,
			session_digest TEXT,
			source_ip TEXT,
			credential_revision TEXT,
			challenge TEXT NOT NULL,
			origin TEXT,
			rp_id TEXT,
			expires_at INTEGER NOT NULL
		);
		CREATE INDEX idx_access_factor_challenges_expiry ON access_factor_challenges(expires_at);
		CREATE TABLE access_passkeys (
			credential_id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
			public_key TEXT NOT NULL,
			generation TEXT NOT NULL,
			counter INTEGER NOT NULL CHECK (counter >= 0),
			transports TEXT NOT NULL,
			name TEXT,
			backed_up INTEGER NOT NULL CHECK (backed_up IN (0,1)),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			last_used_at INTEGER
		);
		CREATE INDEX idx_access_passkeys_user ON access_passkeys(user_id);
	`);
}
