import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';

export interface ConfigurationPolicy {
	ipWhitelist: string;
	ipBlacklistEnabled: boolean;
	maxLoginAttempts: number;
	loginBanDuration: number;
	statusMonitorIntervalSeconds: number;
	remoteHostRefreshIntervalSeconds: number;
	passkeys: Array<{ origin: string; rpId: string }>;
}

export interface ConfigurationCaptcha {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
	secretKey: string;
	expectedHostname: string | null;
}

export interface ConfigurationRecord {
	version: number;
	policy: ConfigurationPolicy;
	captcha: ConfigurationCaptcha;
}

export interface ConfigurationView {
	current: ConfigurationRecord;
	effectiveVersion: number;
	effectiveMonitoring: {
		statusMonitorIntervalSeconds: number;
		remoteHostRefreshIntervalSeconds: number;
	};
}

export type ConfigurationSecret = { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export interface ConfigurationCaptchaInput {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
	secret: ConfigurationSecret;
	expectedHostname: string | null;
}

export interface ConfigurationUpdate {
	expectedVersion: number;
	policy: ConfigurationPolicy;
	captcha: ConfigurationCaptchaInput;
}

export interface ConfigurationCaptchaUpdate {
	expectedVersion: number;
	captcha: ConfigurationCaptchaInput;
}

export interface ConfigurationSeed {
	policy: ConfigurationPolicy;
	captcha: ConfigurationCaptcha;
}

export interface ConfigurationActor {
	userId: number | null;
}
