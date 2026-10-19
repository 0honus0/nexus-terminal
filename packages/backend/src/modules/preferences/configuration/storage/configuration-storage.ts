import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';

export interface StoredConfiguration {
	version: number;
	ipWhitelist: string;
	ipBlacklistEnabled: boolean;
	maxLoginAttempts: number;
	loginBanDuration: number;
	statusMonitorIntervalSeconds: number;
	remoteHostRefreshIntervalSeconds: number;
	passkeys: Array<{ origin: string; rpId: string }>;
	captchaEnabled: boolean;
	captchaProvider: AccessCaptchaProvider;
	captchaSiteKey: string;
	captchaSecretEncrypted: string | null;
	captchaExpectedHostname: string | null;
}

export interface ConfigurationStorage {
	initialize(value: StoredConfiguration): Promise<StoredConfiguration>;
	find(): Promise<StoredConfiguration | null>;
	update(
		expectedVersion: number,
		value: StoredConfiguration,
		authorization: ConfigurationWriteAuthorization,
	): Promise<StoredConfiguration | null>;
}

export interface ConfigurationWriteAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}
