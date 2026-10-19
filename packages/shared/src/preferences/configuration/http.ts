import type { SettingsPolicy, SettingsView, SettingsCaptchaView } from './model.js';
import type { AccessCaptchaProvider } from '../../access/values.js';
import type { SettingsErrorCode } from './values.js';

export type SettingsSecretCommand = { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export interface SettingsCaptchaCommand {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
	secret: SettingsSecretCommand;
	expectedHostname: string | null;
}

export interface SettingsUpdateRequest {
	expectedVersion: number;
	policy: SettingsPolicy;
	captcha: SettingsCaptchaCommand;
}

export interface SettingsCaptchaUpdateRequest {
	expectedVersion: number;
	captcha: SettingsCaptchaCommand;
}

export interface SettingsCaptchaResponse {
	version: number;
	effectiveVersion: number;
	requiresRestart: boolean;
	captcha: SettingsCaptchaView;
}

export type SettingsResponse = SettingsView;

export interface SettingsErrorResponse {
	code: SettingsErrorCode;
}
