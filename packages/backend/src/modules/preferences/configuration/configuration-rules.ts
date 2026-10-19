import type { ConfigurationRecord, ConfigurationPolicy, ConfigurationCaptcha } from './model/configuration-types.js';
import { PreferencesFailure } from '../preferences-failure.js';
import {
	SETTINGS_WHITELIST_MAX_BYTES,
	SETTINGS_CAPTCHA_KEY_MAX_BYTES,
	SETTINGS_MAX_PASSKEY_SITES,
	SETTINGS_MONITORING_MIN_SECONDS,
	SETTINGS_MONITORING_MAX_SECONDS,
} from '@nexus-terminal/shared/preferences/configuration/values';

function bounded(value: number, min: number, max: number): boolean {
	return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validText(value: string, max: number): boolean {
	return (
		typeof value === 'string' &&
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value &&
		!value.includes('\0') &&
		Buffer.byteLength(value, 'utf8') <= max
	);
}

function validateCaptcha(captcha: ConfigurationCaptcha): void {
	if (
		typeof captcha.enabled !== 'boolean' ||
		!['none', 'hcaptcha', 'recaptcha'].includes(captcha.provider) ||
		!validText(captcha.siteKey, SETTINGS_CAPTCHA_KEY_MAX_BYTES) ||
		!validText(captcha.secretKey, SETTINGS_CAPTCHA_KEY_MAX_BYTES) ||
		(captcha.expectedHostname !== null &&
			(!validText(captcha.expectedHostname, 253) || !/^[a-z0-9.-]+$/iu.test(captcha.expectedHostname))) ||
		(captcha.enabled &&
			(captcha.provider === 'none' ||
				!captcha.siteKey.trim() ||
				!captcha.secretKey.trim() ||
				!captcha.expectedHostname))
	) {
		throw new PreferencesFailure('invalid_input');
	}
}

function validatePasskeySites(sites: ConfigurationPolicy['passkeys']): void {
	const origins = new Set<string>();
	const protocols = new Set<string>();
	for (const site of sites) {
		let url: URL;
		try {
			url = new URL(site.origin);
		} catch (cause) {
			throw new PreferencesFailure('invalid_input', { cause });
		}
		if (
			!validText(site.origin, 2048) ||
			site.origin !== url.origin ||
			url.username ||
			url.password ||
			!['http:', 'https:'].includes(url.protocol) ||
			(url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') ||
			url.hostname.length > 253 ||
			!validText(site.rpId, 253) ||
			!/^[a-z0-9.-]+$/u.test(site.rpId) ||
			(url.hostname !== site.rpId && !url.hostname.endsWith('.' + site.rpId)) ||
			origins.has(site.origin)
		) {
			throw new PreferencesFailure('invalid_input');
		}
		origins.add(site.origin);
		protocols.add(url.protocol);
	}
	if (protocols.size > 1) {
		throw new PreferencesFailure('invalid_input');
	}
}

export function validateConfiguration(record: ConfigurationRecord, validateNetwork: (value: string) => void): void {
	const value = record.policy;
	validateCaptcha(record.captcha);
	if (
		!bounded(record.version, 1, Number.MAX_SAFE_INTEGER) ||
		typeof value.ipBlacklistEnabled !== 'boolean' ||
		!validText(value.ipWhitelist, SETTINGS_WHITELIST_MAX_BYTES) ||
		!bounded(value.maxLoginAttempts, 1, 1000) ||
		!bounded(value.loginBanDuration, 1, 30 * 86400) ||
		!bounded(
			value.statusMonitorIntervalSeconds,
			SETTINGS_MONITORING_MIN_SECONDS,
			SETTINGS_MONITORING_MAX_SECONDS,
		) ||
		!bounded(
			value.remoteHostRefreshIntervalSeconds,
			SETTINGS_MONITORING_MIN_SECONDS,
			SETTINGS_MONITORING_MAX_SECONDS,
		) ||
		!Array.isArray(value.passkeys) ||
		value.passkeys.length > SETTINGS_MAX_PASSKEY_SITES
	) {
		throw new PreferencesFailure('invalid_input');
	}
	const networks = value.ipWhitelist
		.split(/[\n,]+/u)
		.map((item) => item.trim())
		.filter(Boolean);
	if (networks.length > 256 || (value.ipWhitelist.trim() && !networks.length)) {
		throw new PreferencesFailure('invalid_input');
	}
	for (const network of networks) {
		validateNetwork(network);
	}
	validatePasskeySites(value.passkeys);
}
