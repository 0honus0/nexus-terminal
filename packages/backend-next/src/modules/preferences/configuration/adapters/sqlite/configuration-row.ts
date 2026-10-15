import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredConfiguration } from '../../storage/configuration-storage.js';
import {
	SETTINGS_CAPTCHA_KEY_MAX_BYTES,
	SETTINGS_WHITELIST_MAX_BYTES,
	SETTINGS_MAX_PASSKEY_SITES,
} from '@nexus-terminal/shared/preferences/configuration/values';

function text(value: unknown, max: number): string {
	if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > max) {
		throw new Error('Corrupt preferences text');
	}
	return value;
}

function integer(value: unknown, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error('Corrupt preferences integer');
	}
	return value;
}

function boolean(value: unknown): boolean {
	return integer(value, 0, 1) === 1;
}

function passkeys(value: unknown): StoredConfiguration['passkeys'] {
	const parsed: unknown = JSON.parse(text(value, 40 * 1024));
	if (!Array.isArray(parsed) || parsed.length > SETTINGS_MAX_PASSKEY_SITES) {
		throw new Error('Corrupt preferences passkeys');
	}
	return parsed.map((item: unknown) => {
		if (
			item === null ||
			typeof item !== 'object' ||
			Array.isArray(item) ||
			Object.keys(item).length !== 2 ||
			!('origin' in item) ||
			!('rpId' in item)
		) {
			throw new Error('Corrupt preferences site');
		}
		return { origin: text(item.origin, 2048), rpId: text(item.rpId, 253) };
	});
}

export function configurationRow(row: SqlRow | null): StoredConfiguration {
	if (!row) {
		throw new Error('Missing preferences configuration');
	}
	const provider = row.captcha_provider;
	if (provider !== 'none' && provider !== 'hcaptcha' && provider !== 'recaptcha') {
		throw new Error('Corrupt preferences provider');
	}
	return {
		version: integer(row.version, 1, Number.MAX_SAFE_INTEGER),
		ipWhitelist: text(row.ip_whitelist, SETTINGS_WHITELIST_MAX_BYTES),
		ipBlacklistEnabled: boolean(row.blacklist_enabled),
		maxLoginAttempts: integer(row.max_login_attempts, 1, 1000),
		loginBanDuration: integer(row.login_ban_seconds, 1, 2592000),
		statusMonitorIntervalSeconds: integer(row.status_interval_seconds, 1, 86400),
		remoteHostRefreshIntervalSeconds: integer(row.resource_refresh_seconds, 1, 86400),
		passkeys: passkeys(row.passkeys_json),
		captchaEnabled: boolean(row.captcha_enabled),
		captchaProvider: provider,
		captchaSiteKey: text(row.captcha_site_key, SETTINGS_CAPTCHA_KEY_MAX_BYTES),
		captchaSecretEncrypted: row.captcha_secret_encrypted === null ? null : text(row.captcha_secret_encrypted, 4096),
		captchaExpectedHostname:
			row.captcha_expected_hostname === null ? null : text(row.captcha_expected_hostname, 253),
	};
}
