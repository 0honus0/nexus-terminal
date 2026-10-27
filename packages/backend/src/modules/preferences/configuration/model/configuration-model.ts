import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { ConfigurationStorage, StoredConfiguration } from '../storage/configuration-storage.js';
import type { ConfigurationRecord, ConfigurationActor } from './configuration-types.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { SourceAddresses } from '../../../../platform/security/source-address.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { PreferencesFailure } from '../../preferences-failure.js';

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof PreferencesFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			const unknown = cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed';
			throw new PreferencesFailure(unknown ? 'operation_unknown' : 'storage_unavailable', { cause });
		}
		throw new PreferencesFailure('internal_failure', { cause });
	}
}

export function fromStoredConfiguration(value: StoredConfiguration, secrets: SecretBox | null): ConfigurationRecord {
	let secretKey = '';
	try {
		if (value.captchaSecretEncrypted !== null) {
			if (!secrets) {
				throw new PreferencesFailure('unavailable');
			}
			secretKey = secrets.decrypt(value.captchaSecretEncrypted, 'preferences:captcha');
		}
	} catch (cause) {
		throw new PreferencesFailure('unavailable', { cause });
	}
	return {
		version: value.version,
		policy: {
			ipWhitelist: value.ipWhitelist,
			ipBlacklistEnabled: value.ipBlacklistEnabled,
			maxLoginAttempts: value.maxLoginAttempts,
			loginBanDuration: value.loginBanDuration,
			statusMonitorIntervalSeconds: value.statusMonitorIntervalSeconds,
			remoteHostRefreshIntervalSeconds: value.remoteHostRefreshIntervalSeconds,
			passkeys: value.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
		},
		captcha: {
			enabled: value.captchaEnabled,
			provider: value.captchaProvider,
			siteKey: value.captchaSiteKey,
			secretKey,
			expectedHostname: value.captchaExpectedHostname,
		},
	};
}

export class ConfigurationModel {
	constructor(
		private readonly storage: ConfigurationStorage,
		private readonly secrets: SecretBox | null,
		private readonly addresses: SourceAddresses,
		private readonly tokens: SessionTokens,
	) {}

	validateNetwork(value: string): void {
		try {
			this.addresses.parseNetwork(value);
		} catch (cause) {
			throw new PreferencesFailure('invalid_input', { cause });
		}
	}

	private toStorage(value: ConfigurationRecord): StoredConfiguration {
		return {
			version: value.version,
			ipWhitelist: value.policy.ipWhitelist,
			ipBlacklistEnabled: value.policy.ipBlacklistEnabled,
			maxLoginAttempts: value.policy.maxLoginAttempts,
			loginBanDuration: value.policy.loginBanDuration,
			statusMonitorIntervalSeconds: value.policy.statusMonitorIntervalSeconds,
			remoteHostRefreshIntervalSeconds: value.policy.remoteHostRefreshIntervalSeconds,
			passkeys: value.policy.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
			captchaEnabled: value.captcha.enabled,
			captchaProvider: value.captcha.provider,
			captchaSiteKey: value.captcha.siteKey,
			captchaSecretEncrypted: this.encryptSecret(value.captcha.secretKey),
			captchaExpectedHostname: value.captcha.expectedHostname,
		};
	}

	private encryptSecret(value: string): string | null {
		if (!value) {
			return null;
		}
		if (!this.secrets) {
			throw new PreferencesFailure('unavailable');
		}
		try {
			return this.secrets.encrypt(value, 'preferences:captcha');
		} catch (cause) {
			throw new PreferencesFailure('unavailable', { cause });
		}
	}

	async initialize(seed: ConfigurationRecord): Promise<ConfigurationRecord> {
		const command = this.toStorage(seed);
		const existing = await storage(() => this.storage.initialize(command));
		return fromStoredConfiguration(existing, this.secrets);
	}

	async find(): Promise<ConfigurationRecord | null> {
		const saved = await storage(() => this.storage.find());
		if (saved === null) {
			return null;
		}
		return fromStoredConfiguration(saved, this.secrets);
	}

	async get(): Promise<ConfigurationRecord> {
		const value = await this.find();
		if (!value) {
			throw new PreferencesFailure('storage_unavailable');
		}
		return value;
	}

	async update(
		expectedVersion: number,
		value: ConfigurationRecord,
		token: string,
		admit: (actor: ConfigurationActor) => void,
	): Promise<ConfigurationRecord | null> {
		const command = this.toStorage(value);
		const saved = await storage(() =>
			this.storage.update(expectedVersion, command, {
				sessionDigest: this.tokens.digest(token),

				admit: (userId) => admit({ userId }),
			}),
		);
		if (saved === null) {
			return null;
		}
		try {
			return fromStoredConfiguration(saved, this.secrets);
		} catch (cause) {
			throw new PreferencesFailure('operation_unknown', { cause });
		}
	}
}
