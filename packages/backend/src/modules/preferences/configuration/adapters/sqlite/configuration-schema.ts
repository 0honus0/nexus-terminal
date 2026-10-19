import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesConfiguration(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE preferences_configuration (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL CHECK(version>=1),
 ip_whitelist TEXT NOT NULL,
 blacklist_enabled INTEGER NOT NULL CHECK(blacklist_enabled IN (0,1)),
 max_login_attempts INTEGER NOT NULL CHECK(max_login_attempts BETWEEN 1 AND 1000),
 login_ban_seconds INTEGER NOT NULL CHECK(login_ban_seconds BETWEEN 1 AND 2592000),
 status_interval_seconds INTEGER NOT NULL CHECK(status_interval_seconds BETWEEN 1 AND 86400),
 resource_refresh_seconds INTEGER NOT NULL CHECK(resource_refresh_seconds BETWEEN 1 AND 86400),
 passkeys_json TEXT NOT NULL,
 captcha_enabled INTEGER NOT NULL CHECK(captcha_enabled IN (0,1)),
 captcha_provider TEXT NOT NULL CHECK(captcha_provider IN ('none','hcaptcha','recaptcha')),
 captcha_site_key TEXT NOT NULL,
 captcha_secret_encrypted TEXT,
 captcha_expected_hostname TEXT
 );`);
}
