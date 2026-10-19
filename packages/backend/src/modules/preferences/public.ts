import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';

/** Backend installation only. No HTTP projection may expose secretKey. */
export interface PreferencesInstallation {
	version: number;
	ipWhitelist: string;
	ipBlacklistEnabled: boolean;
	maxLoginAttempts: number;
	loginBanDuration: number;
	statusMonitorIntervalSeconds: number;
	remoteHostRefreshIntervalSeconds: number;
	passkeys: Array<{ origin: string; rpId: string }>;
	captcha: {
		enabled: boolean;
		provider: AccessCaptchaProvider;
		siteKey: string;
		secretKey: string;
		expectedHostname: string | null;
	};
}
