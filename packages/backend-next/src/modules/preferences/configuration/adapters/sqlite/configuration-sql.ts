import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlParameter } from '../../../../../platform/storage/sqlite/worker-types.js';
import type {
	ConfigurationStorage,
	StoredConfiguration,
	ConfigurationWriteAuthorization,
} from '../../storage/configuration-storage.js';
import { configurationRow } from './configuration-row.js';

function parameters(value: StoredConfiguration): SqlParameter[] {
	return [
		value.version,
		value.ipWhitelist,
		value.ipBlacklistEnabled ? 1 : 0,
		value.maxLoginAttempts,
		value.loginBanDuration,
		value.statusMonitorIntervalSeconds,
		value.remoteHostRefreshIntervalSeconds,
		JSON.stringify(value.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId }))),
		value.captchaEnabled ? 1 : 0,
		value.captchaProvider,
		value.captchaSiteKey,
		value.captchaSecretEncrypted,
		value.captchaExpectedHostname,
	];
}

export class SqliteConfigurationStorage implements ConfigurationStorage {
	private readTransactionIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readTransactionIdentity) {
			throw new Error('Configuration write identity already installed');
		}
		this.readTransactionIdentity = read;
	}

	initialize(value: StoredConfiguration): Promise<StoredConfiguration> {
		return this.db.transaction(async (tx) => {
			await tx.run(
				`INSERT INTO preferences_configuration (
 id, version, ip_whitelist, blacklist_enabled, max_login_attempts, login_ban_seconds,
 status_interval_seconds, resource_refresh_seconds, passkeys_json, captcha_enabled,
 captcha_provider, captcha_site_key, captcha_secret_encrypted, captcha_expected_hostname
) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
				parameters(value),
			);
			return configurationRow(await tx.one('SELECT * FROM preferences_configuration WHERE id=1'));
		});
	}

	async find(): Promise<StoredConfiguration | null> {
		const row = await this.db.one('SELECT * FROM preferences_configuration WHERE id=1');
		return row === null ? null : configurationRow(row);
	}

	update(
		expectedVersion: number,
		value: StoredConfiguration,
		authorization: ConfigurationWriteAuthorization,
	): Promise<StoredConfiguration | null> {
		const readIdentity = this.readTransactionIdentity;
		if (!readIdentity) {
			return Promise.reject(new Error('Configuration write identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await readIdentity(tx, authorization.sessionDigest));
			const changed = await tx.run(
				`UPDATE preferences_configuration SET
 version=?, ip_whitelist=?, blacklist_enabled=?, max_login_attempts=?, login_ban_seconds=?,
 status_interval_seconds=?, resource_refresh_seconds=?, passkeys_json=?, captcha_enabled=?,
 captcha_provider=?, captcha_site_key=?, captcha_secret_encrypted=?, captcha_expected_hostname=?
 WHERE id=1 AND version=?`,
				[...parameters(value), expectedVersion],
			);
			return changed.changes === 1
				? configurationRow(await tx.one('SELECT * FROM preferences_configuration WHERE id=1'))
				: null;
		});
	}
}
