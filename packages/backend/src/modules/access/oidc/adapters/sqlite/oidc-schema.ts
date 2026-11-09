import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeOidcSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE access_oidc_configuration (
			id INTEGER PRIMARY KEY CHECK(id=1),
			revision TEXT NOT NULL,
			user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
			enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
			label TEXT NOT NULL,
			issuer TEXT NOT NULL,
			client_id TEXT NOT NULL,
			client_authentication TEXT NOT NULL CHECK(client_authentication IN ('client_secret_basic','client_secret_post','none')),
			secret_cipher TEXT,
			subject TEXT
		);
		CREATE TABLE access_oidc_flows (
			cookie_digest TEXT PRIMARY KEY,
			consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),
			revision TEXT NOT NULL,
			purpose TEXT NOT NULL CHECK(purpose IN ('login','binding')),
			session_digest TEXT REFERENCES access_sessions(token_digest) ON DELETE CASCADE,
			password_revision TEXT NOT NULL,
			redirect_uri TEXT NOT NULL,
			state TEXT NOT NULL,
			nonce TEXT NOT NULL,
			verifier_cipher TEXT NOT NULL,
			remember_me INTEGER NOT NULL CHECK(remember_me IN (0,1)),
			expires_at INTEGER NOT NULL
		);
		CREATE INDEX access_oidc_flows_expiry ON access_oidc_flows(expires_at);
		CREATE TABLE access_oidc_sessions (
			token_digest TEXT PRIMARY KEY REFERENCES access_sessions(token_digest) ON DELETE CASCADE
		);
	`);
}

/** Visibility follows the verified binding; configuration no longer has a second switch. */
export async function removeOidcVisibilitySwitch(tx: SqlExecutor): Promise<void> {
	await tx.exec('ALTER TABLE access_oidc_configuration DROP COLUMN enabled');
}
