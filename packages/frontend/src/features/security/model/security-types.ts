import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';
import type { PasskeyLoginInput } from '@/features/auth/public';
import type { Ref, ComputedRef } from 'vue';
import type { CoreConfiguration, NetworkPolicy, CaptchaDraft } from '@/features/preferences/public';

/** Ephemeral setup material belongs to this mounted settings flow, never persisted. */
export interface TotpSetup {
	secret: string;
	qrCodeUrl: string;
}

export interface TwoFactorSettingsController {
	setup: Ref<TotpSetup | null>;
	verificationCode: Ref<string>;
	disablePassword: Ref<string>;
	loading: Ref<boolean>;
	message: Ref<string>;
	success: Ref<boolean>;
	needsRefresh: Ref<boolean>;
	begin(): Promise<void>;
	activate(): Promise<void>;
	disable(): Promise<void>;
	refresh(): Promise<void>;
	cancel(): void;
}

export interface PasskeySummary {
	credentialId: string;
	name: string | null;
	transports: string[];
	createdAtMs: number;
	lastUsedAtMs: number | null;
}

export interface PasskeySettingsController {
	passkeys: Ref<PasskeySummary[]>;
	names: Ref<Record<string, string>>;
	editing: Ref<string | null>;
	loading: Ref<boolean>;
	needsRefresh: Ref<boolean>;
	message: Ref<string>;
	success: Ref<boolean>;
	refresh(): Promise<void>;
	register(): Promise<void>;
	saveName(key: PasskeySummary): Promise<void>;
	remove(key: PasskeySummary): Promise<void>;
}

export interface BlockedAddress {
	ip: string;
	attempts: number;
	lastAttemptAtMs: number;
	blockedUntilMs: number | null;
}

export interface LoginCaptchaConfig {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
}

export interface SecurityConfigurationController {
	snapshot: Ref<CoreConfiguration | null>;
	network: Ref<NetworkPolicy>;
	captcha: Ref<CaptchaDraft>;
	loading: Ref<boolean>;
	needsRefresh: Ref<boolean>;
	message: Ref<string>;
	success: Ref<boolean>;
	refresh(): Promise<void>;
	saveNetwork(changes?: Partial<NetworkPolicy>): Promise<void>;
	saveCaptcha(): Promise<void>;
}

export interface IpBlacklistController {
	entries: Ref<BlockedAddress[]>;
	total: Ref<number>;
	offset: Ref<number>;
	pageSize: number;
	loading: Ref<boolean>;
	needsRefresh: Ref<boolean>;
	message: Ref<string>;
	refresh(): Promise<void>;
	previous(): Promise<void>;
	next(): Promise<void>;
	remove(ip: string): Promise<void>;
}

export type CaptchaStatus = 'loading' | 'ready' | 'error' | 'invalid';

export interface LoginSecurityController {
	captchaConfig: ComputedRef<LoginCaptchaConfig>;
	captchaStatus: ComputedRef<CaptchaStatus>;
	loading: ComputedRef<boolean>;
	refresh(): Promise<void>;
	loginWithPasskey(input: PasskeyLoginInput): Promise<void>;
}
