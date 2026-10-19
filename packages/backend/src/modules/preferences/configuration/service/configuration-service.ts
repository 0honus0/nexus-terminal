import { PreferencesTasks } from '../../preferences-lifecycle.js';
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
import { validateConfiguration } from '../configuration-rules.js';

function admitAdministrator(actor: ConfigurationActor): void {
	if (actor.userId === null) {
		throw new PreferencesFailure('unauthenticated');
	}
	if (actor.userId !== 1) {
		throw new PreferencesFailure('forbidden');
	}
}

/** Immutable installed version; edits become effective together at the next application startup. */
export class ConfigurationService {
	private effective: ConfigurationRecord | null = null;
	private accepting = true;
	private readonly tasks = new PreferencesTasks();
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
		validateConfiguration(record, (network) => this.model.validateNetwork(network));
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
		if (this.tasks.size >= 8) {
			return Promise.reject(new PreferencesFailure('unavailable'));
		}
		return this.tasks.run(work);
	}

	private view(record: ConfigurationRecord): ConfigurationView {
		if (!this.effective) {
			throw new PreferencesFailure('unavailable');
		}
		return {
			current: record,
			effectiveVersion: this.effective.version,
			effectiveMonitoring: {
				statusMonitorIntervalSeconds: this.effective.policy.statusMonitorIntervalSeconds,
				remoteHostRefreshIntervalSeconds: this.effective.policy.remoteHostRefreshIntervalSeconds,
			},
		};
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
		if (
			!Number.isSafeInteger(expectedVersion) ||
			expectedVersion < 1 ||
			expectedVersion >= Number.MAX_SAFE_INTEGER
		) {
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
			this.closePromise = this.tasks.drain();
		}
		return this.closePromise;
	}
}
