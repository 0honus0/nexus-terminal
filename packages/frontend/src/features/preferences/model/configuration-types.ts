import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';
import type { SettingsErrorCode } from '@nexus-terminal/shared/preferences/configuration/values';
import type { HttpRequestFailureCode, RequestOutcome } from '@/client/http/request-failure';
import type { ComputedRef, Ref } from 'vue';

export interface MonitoringIntervals {
	statusIntervalSeconds: number;
	hostIntervalSeconds: number;
}

export interface MonitoringDraft {
	statusIntervalSeconds: number;
	hostIntervalSeconds: number;
}

export interface NetworkPolicy {
	whitelist: string;
	blacklistEnabled: boolean;
	maxLoginAttempts: number;
	loginBanDuration: number;
}

export interface CaptchaSettings {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
	hasSecret: boolean;
	hostname: string;
}

export interface CoreConfiguration {
	revision: number;
	effectiveRevision: number;
	pendingRestart: boolean;
	network: NetworkPolicy;
	statusIntervalSeconds: number;
	hostIntervalSeconds: number;
	effectiveMonitoring: MonitoringIntervals;
	passkeySites: { origin: string; rpId: string }[];
	captcha: CaptchaSettings;
}

export interface CaptchaDraft {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
	hostname: string;
	secretAction: 'keep' | 'clear' | 'replace';
	secretValue: string;
}

export type ConfigurationFailureCode = SettingsErrorCode | HttpRequestFailureCode;

export class ConfigurationFailure extends Error {
	constructor(
		readonly code: ConfigurationFailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Configuration request failed', options);
		this.name = 'ConfigurationFailure';
	}
}

export type MonitoringFeedback = 'saved' | 'conflict' | 'unknown' | ConfigurationFailureCode;

export interface MonitoringConfigurationController {
	snapshot: Readonly<Ref<CoreConfiguration | null>>;
	draft: Ref<MonitoringDraft | null>;
	loading: Readonly<Ref<boolean>>;
	needsRefresh: Readonly<Ref<boolean>>;
	feedback: Readonly<Ref<MonitoringFeedback | null>>;
	canSave: ComputedRef<boolean>;
	refresh(): Promise<void>;
	save(): Promise<void>;
	activate(): void;
	deactivate(): void;
	dispose(): void;
}
