import type { SettingsPolicy, SettingsCaptchaView, SettingsView } from './model.js';
import type {
	SettingsCaptchaCommand,
	SettingsSecretCommand,
	SettingsUpdateRequest,
	SettingsCaptchaUpdateRequest,
	SettingsCaptchaResponse,
	SettingsErrorResponse,
} from './http.js';
import {
	SETTINGS_ERROR_CODES,
	SETTINGS_REQUEST_MAX_BYTES,
	SETTINGS_WHITELIST_MAX_BYTES,
	SETTINGS_CAPTCHA_KEY_MAX_BYTES,
	SETTINGS_MAX_PASSKEY_SITES,
	SETTINGS_RESPONSE_MAX_BYTES,
} from './values.js';

export class InvalidSettingsPayload extends Error {
	constructor() {
		super('Invalid settings payload');
		this.name = 'InvalidSettingsPayload';
	}
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function object(input: unknown, keys: string[]): Record<string, unknown> {
	if (
		!isRecord(input) ||
		Object.keys(input).length !== keys.length ||
		Object.keys(input).some((key) => !keys.includes(key))
	) {
		throw new InvalidSettingsPayload();
	}
	return input;
}

function integer(input: unknown, min: number, max: number): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
		throw new InvalidSettingsPayload();
	}
	return input;
}

function boolean(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidSettingsPayload();
	}
	return input;
}

function text(input: unknown, max: number, empty = true): string {
	if (
		typeof input !== 'string' ||
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(input)) !== input ||
		input.includes('\0') ||
		(!empty && !input) ||
		new TextEncoder().encode(input).length > max
	) {
		throw new InvalidSettingsPayload();
	}
	return input;
}

function provider(input: unknown) {
	if (input !== 'none' && input !== 'hcaptcha' && input !== 'recaptcha') {
		throw new InvalidSettingsPayload();
	}
	return input;
}

function hostname(input: unknown): string | null {
	return input === null ? null : text(input, 253, false);
}

function policy(input: unknown): SettingsPolicy {
	const value = object(input, [
		'ipWhitelist',
		'ipBlacklistEnabled',
		'maxLoginAttempts',
		'loginBanDuration',
		'statusMonitorIntervalSeconds',
		'remoteHostRefreshIntervalSeconds',
		'passkeys',
	]);
	if (!Array.isArray(value.passkeys) || value.passkeys.length > SETTINGS_MAX_PASSKEY_SITES) {
		throw new InvalidSettingsPayload();
	}
	const passkeys = value.passkeys.map((raw: unknown) => {
		const item = object(raw, ['origin', 'rpId']);
		return { origin: text(item.origin, 2048, false), rpId: text(item.rpId, 253, false) };
	});
	if (new Set(passkeys.map((item) => item.origin)).size !== passkeys.length) {
		throw new InvalidSettingsPayload();
	}
	return {
		ipWhitelist: text(value.ipWhitelist, SETTINGS_WHITELIST_MAX_BYTES),
		ipBlacklistEnabled: boolean(value.ipBlacklistEnabled),
		maxLoginAttempts: integer(value.maxLoginAttempts, 1, 1000),
		loginBanDuration: integer(value.loginBanDuration, 1, 30 * 86400),
		statusMonitorIntervalSeconds: integer(value.statusMonitorIntervalSeconds, 1, 86400),
		remoteHostRefreshIntervalSeconds: integer(value.remoteHostRefreshIntervalSeconds, 1, 86400),
		passkeys,
	};
}

function secret(input: unknown): SettingsSecretCommand {
	if (input === null || typeof input !== 'object' || !('action' in input)) {
		throw new InvalidSettingsPayload();
	}
	if (input.action === 'keep' || input.action === 'clear') {
		object(input, ['action']);
		return { action: input.action };
	}
	const value = object(input, ['action', 'value']);
	if (value.action !== 'replace') {
		throw new InvalidSettingsPayload();
	}
	return { action: 'replace', value: text(value.value, SETTINGS_CAPTCHA_KEY_MAX_BYTES, false) };
}

function captcha(input: unknown): SettingsCaptchaCommand {
	const value = object(input, ['enabled', 'provider', 'siteKey', 'secret', 'expectedHostname']);
	return {
		enabled: boolean(value.enabled),
		provider: provider(value.provider),
		siteKey: text(value.siteKey, SETTINGS_CAPTCHA_KEY_MAX_BYTES),
		secret: secret(value.secret),
		expectedHostname: hostname(value.expectedHostname),
	};
}

function captchaView(input: unknown): SettingsCaptchaView {
	const value = object(input, ['enabled', 'provider', 'siteKey', 'hasSecret', 'expectedHostname']);
	const view: SettingsCaptchaView = {
		enabled: boolean(value.enabled),
		provider: provider(value.provider),
		siteKey: text(value.siteKey, SETTINGS_CAPTCHA_KEY_MAX_BYTES),
		hasSecret: boolean(value.hasSecret),
		expectedHostname: hostname(value.expectedHostname),
	};
	if (
		view.enabled &&
		(view.provider === 'none' || !view.siteKey.trim() || !view.hasSecret || !view.expectedHostname)
	) {
		throw new InvalidSettingsPayload();
	}
	return view;
}

export function readSettingsUpdate(input: unknown): SettingsUpdateRequest {
	budget(input, SETTINGS_REQUEST_MAX_BYTES);
	const value = object(input, ['expectedVersion', 'policy', 'captcha']);
	return {
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		policy: policy(value.policy),
		captcha: captcha(value.captcha),
	};
}

export function readSettingsCaptchaUpdate(input: unknown): SettingsCaptchaUpdateRequest {
	budget(input, SETTINGS_REQUEST_MAX_BYTES);
	const value = object(input, ['expectedVersion', 'captcha']);
	return {
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		captcha: captcha(value.captcha),
	};
}

function activation(value: Record<string, unknown>) {
	const version = integer(value.version, 1, Number.MAX_SAFE_INTEGER);
	const effectiveVersion = integer(value.effectiveVersion, 1, version);
	const requiresRestart = boolean(value.requiresRestart);
	if (requiresRestart !== (effectiveVersion !== version)) {
		throw new InvalidSettingsPayload();
	}
	return { version, effectiveVersion, requiresRestart };
}

function budget(input: unknown, max: number): void {
	try {
		const encoded = JSON.stringify(input);
		if (encoded === undefined || new TextEncoder().encode(encoded).length > max) {
			throw new InvalidSettingsPayload();
		}
	} catch {
		throw new InvalidSettingsPayload();
	}
}

export function readSettingsResponse(input: unknown): SettingsView {
	const value = object(input, ['version', 'effectiveVersion', 'requiresRestart', 'policy', 'captcha']);
	budget(value, SETTINGS_RESPONSE_MAX_BYTES);
	const state = activation(value);
	return {
		version: state.version,
		effectiveVersion: state.effectiveVersion,
		requiresRestart: state.requiresRestart,
		policy: policy(value.policy),
		captcha: captchaView(value.captcha),
	};
}

export function readSettingsCaptchaResponse(input: unknown): SettingsCaptchaResponse {
	const value = object(input, ['version', 'effectiveVersion', 'requiresRestart', 'captcha']);
	budget(value, SETTINGS_RESPONSE_MAX_BYTES);
	const state = activation(value);
	return {
		version: state.version,
		effectiveVersion: state.effectiveVersion,
		requiresRestart: state.requiresRestart,
		captcha: captchaView(value.captcha),
	};
}

export function readSettingsError(input: unknown): SettingsErrorResponse {
	const value = object(input, ['code']);
	for (const code of SETTINGS_ERROR_CODES) {
		if (value.code === code) {
			return { code };
		}
	}
	throw new InvalidSettingsPayload();
}
