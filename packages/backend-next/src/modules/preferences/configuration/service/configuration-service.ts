import { drainPreferences } from '../../preferences-lifecycle.js';
import type { ConfigurationModel } from '../model/configuration-model.js';
import type {
	ConfigurationRecord,
	ConfigurationSeed,
	ConfigurationActor,
	ConfigurationPolicy,
	ConfigurationView,
	ConfigurationUpdate,
	ConfigurationCaptchaUpdate,
	ConfigurationCaptchaInput,
	ConfigurationCaptcha,
} from '../model/configuration-types.js';
import { PreferencesFailure } from '../../preferences-failure.js';
import {
	SETTINGS_WHITELIST_MAX_BYTES,
	SETTINGS_CAPTCHA_KEY_MAX_BYTES,
	SETTINGS_MAX_PASSKEY_SITES,
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

function admitAdministrator(actor: ConfigurationActor): void {
	if (actor.userId === null) {
		throw new PreferencesFailure('unauthenticated');
	}
	if (actor.userId !== 1) {
		throw new PreferencesFailure('forbidden');
	}
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

/** Immutable installed version; edits become effective together at the next application startup. */
export class ConfigurationService {
	private effective: ConfigurationRecord | null = null;
	private accepting = true;
	private readonly pending = new Set<Promise<unknown>>();
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: ConfigurationModel) {}

	async initialize(seed?: () => ConfigurationSeed): Promise<ConfigurationRecord> {
		let saved = await this.model.find();
		if (!saved) {
			const initial = seed
				? seed()
				: ({
						policy: {
							ipWhitelist: '',
							ipBlacklistEnabled: true,
							maxLoginAttempts: 5,
							loginBanDuration: 300,
							statusMonitorIntervalSeconds: 3,
							remoteHostRefreshIntervalSeconds: 30,
							passkeys: [],
						},
						captcha: {
							enabled: false,
							provider: 'none',
							siteKey: '',
							secretKey: '',
							expectedHostname: null,
						},
					} satisfies ConfigurationSeed);
			const record: ConfigurationRecord = { version: 1, policy: initial.policy, captcha: initial.captcha };
			this.validate(record);
			saved = await this.model.initialize(record);
		}
		this.validateStored(saved);
		this.effective = saved;
		return saved;
	}

	installation(): ConfigurationRecord {
		if (!this.effective || !this.accepting) {
			throw new PreferencesFailure('unavailable');
		}
		return this.effective;
	}

	private validate(record: ConfigurationRecord): void {
		const value = record.policy;
		validateCaptcha(record.captcha);
		if (
			!bounded(record.version, 1, Number.MAX_SAFE_INTEGER) ||
			typeof value.ipBlacklistEnabled !== 'boolean' ||
			!validText(value.ipWhitelist, SETTINGS_WHITELIST_MAX_BYTES) ||
			!bounded(value.maxLoginAttempts, 1, 1000) ||
			!bounded(value.loginBanDuration, 1, 30 * 86400) ||
			!bounded(value.statusMonitorIntervalSeconds, 1, 86400) ||
			!bounded(value.remoteHostRefreshIntervalSeconds, 1, 86400) ||
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
			this.model.validateNetwork(network);
		}
		validatePasskeySites(value.passkeys);
	}

	private validateStored(value: ConfigurationRecord): void {
		try {
			this.validate(value);
		} catch (cause) {
			throw new PreferencesFailure('storage_unavailable', { cause });
		}
	}

	private run<T>(work: () => Promise<T>): Promise<T> {
		if (!this.accepting || !this.effective) {
			return Promise.reject(new PreferencesFailure('unavailable'));
		}
		if (this.pending.size >= 8) {
			return Promise.reject(new PreferencesFailure('unavailable'));
		}
		const pending = Promise.resolve().then(work);
		this.pending.add(pending);
		void pending.finally(() => this.pending.delete(pending)).catch(() => undefined);
		return pending;
	}

	private view(record: ConfigurationRecord): ConfigurationView {
		if (!this.effective) {
			throw new PreferencesFailure('unavailable');
		}
		return { current: record, effectiveVersion: this.effective.version };
	}

	get(): Promise<ConfigurationView> {
		return this.run(async () => {
			const current = await this.model.get();
			this.validateStored(current);
			return this.view(current);
		});
	}

	private async change(
		expectedVersion: number,
		token: string,
		select: (current: ConfigurationRecord) => { policy: ConfigurationPolicy; captcha: ConfigurationCaptchaInput },
	): Promise<ConfigurationView> {
		if (!bounded(expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1)) {
			throw new PreferencesFailure('invalid_input');
		}
		const current = await this.model.get();
		this.validateStored(current);
		if (current.version !== expectedVersion) {
			throw new PreferencesFailure('version_conflict');
		}
		const input = select(current);
		if (
			input.captcha.provider !== current.captcha.provider &&
			input.captcha.secret.action === 'keep' &&
			current.captcha.secretKey
		) {
			throw new PreferencesFailure('invalid_input');
		}
		const secretKey =
			input.captcha.secret.action === 'keep'
				? current.captcha.secretKey
				: input.captcha.secret.action === 'clear'
					? ''
					: input.captcha.secret.value;
		const next: ConfigurationRecord = {
			version: expectedVersion + 1,
			policy: input.policy,
			captcha: {
				enabled: input.captcha.enabled,
				provider: input.captcha.provider,
				siteKey: input.captcha.siteKey,
				secretKey,
				expectedHostname: input.captcha.expectedHostname,
			},
		};
		this.validate(next);
		const saved = await this.model.update(expectedVersion, next, token, admitAdministrator);
		if (!saved) {
			throw new PreferencesFailure('version_conflict');
		}
		return this.view(saved);
	}

	update(command: ConfigurationUpdate, token: string): Promise<ConfigurationView> {
		return this.run(() =>
			this.change(command.expectedVersion, token, () => ({ policy: command.policy, captcha: command.captcha })),
		);
	}

	updateCaptcha(command: ConfigurationCaptchaUpdate, token: string): Promise<ConfigurationView> {
		return this.run(() =>
			this.change(command.expectedVersion, token, (current) => ({
				policy: current.policy,
				captcha: command.captcha,
			})),
		);
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = drainPreferences([...this.pending]);
		}
		return this.closePromise;
	}
}
