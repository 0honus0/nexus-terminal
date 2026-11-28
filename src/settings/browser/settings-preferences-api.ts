import { computed, shallowRef } from 'vue';
import type { z } from 'zod';
import type { StateClient } from '../../state/browser/state-api.js';
import type { LogApi } from '../../log/browser/log-api.js';
import { settingsBase, SettingsSnapshotSchema } from '../settings-http-types.js';
import {
	SettingsTopic,
	defaultSettings,
	type SettingsPatchSchema,
	type SettingsPreferences,
	type SettingsSnapshot,
} from '../settings-types.js';

type Patch = z.infer<typeof SettingsPatchSchema>;

/** 登录会话共用偏好。界面关闭只释放本地预览，已经提交的保存由会话继续处理。 */
export class SettingsPreferencesApi {
	readonly #confirmed;
	readonly #patches = shallowRef<readonly Patch[]>([]);
	readonly #log: Pick<LogApi, 'report'>;
	#scope: AbortController | undefined;
	#unsubscribe: (() => void) | undefined;
	#task = Promise.resolve();
	readonly value = computed<SettingsPreferences>(() =>
		Object.assign({}, this.#confirmed.value.preferences, ...this.#patches.value),
	);

	constructor({ locale, log }: { locale: 'en' | 'zh'; log: Pick<LogApi, 'report'> }) {
		this.#confirmed = shallowRef<SettingsSnapshot>({ revision: 0, preferences: { ...defaultSettings, locale } });
		this.#log = log;
	}

	connect(state?: Pick<StateClient, 'subscribe'>): void {
		// 状态连接重建时保留当前登录会话和已提交的保存。
		this.#unsubscribe?.();
		const scope = (this.#scope ??= new AbortController());
		this.#unsubscribe = state?.subscribe(SettingsTopic, SettingsSnapshotSchema, {
			updated: (snapshot) => this.#accept(snapshot, scope.signal),

			unconfirmed: () => {
				if (!scope.signal.aborted) void this.#refresh(scope.signal).catch(() => undefined);
			},
		});
		void this.#refresh(scope.signal).catch(() => undefined);
	}

	disconnect(): void {
		this.#scope?.abort();
		this.#scope = undefined;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		this.#patches.value = [];
		// 登录页允许临时调整语言，不能把上一登录会话的修订号当作本次服务端确认。
		const { preferences } = this.#confirmed.value;
		this.#confirmed.value = { revision: 0, preferences };
	}

	update(input: Patch): void {
		const patch = { ...input };
		const signal = this.#scope?.signal;
		if (!signal) {
			const snapshot = this.#confirmed.value;
			this.#confirmed.value = { ...snapshot, preferences: { ...snapshot.preferences, ...patch } };
			return;
		}
		this.#patches.value = [...this.#patches.value, patch];
		this.#task = this.#task.then(async () => {
			try {
				signal.throwIfAborted();
				const initialLocale =
					this.#confirmed.value.revision === 0 ? { locale: this.#confirmed.value.preferences.locale } : {};
				const response = await fetch(settingsBase, {
					method: 'PATCH',
					signal,
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...initialLocale, ...patch }),
				});
				if (!response.ok) {
					await response.body?.cancel();
					throw new Error('SETTINGS_SAVE_FAILED');
				}
				this.#accept(SettingsSnapshotSchema.parse(await response.json()), signal);
			} catch {
				if (signal.aborted) return;
				// 读取核对已提交的结果，避免在响应丢失时重放写入。
				await this.#refresh(signal).catch(() => undefined);
				if (
					!signal.aborted &&
					Object.entries(patch).some(
						([key, value]) => this.#confirmed.value.preferences[key as keyof Patch] !== value,
					)
				)
					this.#log.report({
						source: 'settings',
						level: 'error',
						code: 'SETTINGS_SAVE_FAILED',
						userVisible: true,
					});
			} finally {
				this.#patches.value = this.#patches.value.filter((pending) => pending !== patch);
			}
		});
	}

	async #refresh(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const response = await fetch(settingsBase, { signal });
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error('SETTINGS_READ_FAILED');
		}
		const snapshot = SettingsSnapshotSchema.parse(await response.json());
		signal.throwIfAborted();
		if (snapshot.revision === 0 && this.#confirmed.value.revision === 0) {
			// Persist the effective first-login locale, but never overwrite saved/restored preferences.
			const initialized = await fetch(settingsBase, {
				method: 'POST',
				signal,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ locale: this.#confirmed.value.preferences.locale }),
			});
			if (!initialized.ok) {
				await initialized.body?.cancel();
				throw new Error('SETTINGS_SAVE_FAILED');
			}
			this.#accept(SettingsSnapshotSchema.parse(await initialized.json()), signal);
			return;
		}
		this.#accept(snapshot, signal);
	}

	#accept(next: SettingsSnapshot, signal: AbortSignal): void {
		if (signal.aborted || next.revision <= this.#confirmed.value.revision) return;
		this.#confirmed.value = next;
	}
}
