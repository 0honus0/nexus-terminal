import type { SettingsView } from '@nexus-terminal/shared/preferences/configuration/model';
import type {
	SettingsCaptchaCommand,
	SettingsUpdateRequest,
} from '@nexus-terminal/shared/preferences/configuration/http';
import type { CoreConfiguration, CaptchaDraft, NetworkPolicy, MonitoringDraft } from './configuration-types';

export function toCoreConfiguration(value: SettingsView): CoreConfiguration {
	return {
		revision: value.version,
		effectiveRevision: value.effectiveVersion,
		pendingRestart: value.requiresRestart,
		network: {
			whitelist: value.policy.ipWhitelist,
			blacklistEnabled: value.policy.ipBlacklistEnabled,
			maxLoginAttempts: value.policy.maxLoginAttempts,
			loginBanDuration: value.policy.loginBanDuration,
		},
		statusIntervalSeconds: value.policy.statusMonitorIntervalSeconds,
		hostIntervalSeconds: value.policy.remoteHostRefreshIntervalSeconds,
		effectiveMonitoring: {
			statusIntervalSeconds: value.effectiveMonitoring.statusMonitorIntervalSeconds,
			hostIntervalSeconds: value.effectiveMonitoring.remoteHostRefreshIntervalSeconds,
		},
		passkeySites: value.policy.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
		captcha: {
			enabled: value.captcha.enabled,
			provider: value.captcha.provider,
			siteKey: value.captcha.siteKey,
			hasSecret: value.captcha.hasSecret,
			hostname: value.captcha.expectedHostname ?? '',
		},
	};
}

export function toCaptchaCommand(value: CaptchaDraft): SettingsCaptchaCommand {
	return {
		enabled: value.enabled,
		provider: value.provider,
		siteKey: value.siteKey,
		expectedHostname: value.hostname || null,
		secret:
			value.secretAction === 'replace'
				? { action: 'replace', value: value.secretValue }
				: { action: value.secretAction },
	};
}

function configurationUpdate(
	snapshot: CoreConfiguration,
	network: NetworkPolicy,
	monitoring: MonitoringDraft,
): SettingsUpdateRequest {
	return {
		expectedVersion: snapshot.revision,
		policy: {
			ipWhitelist: network.whitelist,
			ipBlacklistEnabled: network.blacklistEnabled,
			maxLoginAttempts: network.maxLoginAttempts,
			loginBanDuration: network.loginBanDuration,
			statusMonitorIntervalSeconds: monitoring.statusIntervalSeconds,
			remoteHostRefreshIntervalSeconds: monitoring.hostIntervalSeconds,
			passkeys: snapshot.passkeySites.map((site) => ({ origin: site.origin, rpId: site.rpId })),
		},
		captcha: {
			enabled: snapshot.captcha.enabled,
			provider: snapshot.captcha.provider,
			siteKey: snapshot.captcha.siteKey,
			expectedHostname: snapshot.captcha.hostname || null,
			secret: { action: 'keep' },
		},
	};
}

export function toNetworkUpdate(snapshot: CoreConfiguration, network: NetworkPolicy): SettingsUpdateRequest {
	return configurationUpdate(snapshot, network, {
		statusIntervalSeconds: snapshot.statusIntervalSeconds,
		hostIntervalSeconds: snapshot.hostIntervalSeconds,
	});
}

export function toMonitoringUpdate(snapshot: CoreConfiguration, draft: MonitoringDraft): SettingsUpdateRequest {
	return configurationUpdate(snapshot, snapshot.network, draft);
}
