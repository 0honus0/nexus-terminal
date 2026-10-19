import type { AccessCaptchaProvider } from '../../access/values.js';

export interface SettingsPasskeySite {
	origin: string;
	rpId: string;
}

export interface SettingsPolicy {
	ipWhitelist: string;
	ipBlacklistEnabled: boolean;
	maxLoginAttempts: number;
	loginBanDuration: number;
	statusMonitorIntervalSeconds: number;
	remoteHostRefreshIntervalSeconds: number;
	passkeys: SettingsPasskeySite[];
}

export interface SettingsCaptchaView {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
	hasSecret: boolean;
	expectedHostname: string | null;
}

export interface SettingsView {
	version: number;
	effectiveVersion: number;
	requiresRestart: boolean;
	policy: SettingsPolicy;
	effectiveMonitoring: SettingsMonitoring;
	captcha: SettingsCaptchaView;
}

export interface SettingsMonitoring {
	statusMonitorIntervalSeconds: number;
	remoteHostRefreshIntervalSeconds: number;
}
