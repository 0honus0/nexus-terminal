import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginStateObserver } from '../../../src/sdk/browser/index.js';
import { SettingsPreferencesApi } from '../../../src/settings/browser/settings-preferences-api.js';
import { defaultSettings, type SettingsSnapshot } from '../../../src/settings/settings-types.js';

function snapshot(revision: number, theme: SettingsSnapshot['preferences']['theme']): SettingsSnapshot {
	return { revision, preferences: { ...defaultSettings, theme } };
}

function session() {
	const log = { report: vi.fn() };
	const preferences = new SettingsPreferencesApi({ locale: 'en', log });
	return { preferences, log };
}

afterEach(() => vi.unstubAllGlobals());

describe('浏览器偏好', () => {
	it('状态订阅较新时忽略迟到的读取，断开后也拒绝旧会话的更新', async () => {
		const entered = Promise.withResolvers<void>();
		const read = Promise.withResolvers<Response>();
		const parsed = Promise.withResolvers<void>();
		const fetch = vi.fn<typeof globalThis.fetch>(() => {
			entered.resolve();
			return read.promise;
		});
		vi.stubGlobal('fetch', fetch);
		const { preferences } = session();
		let observer: PluginStateObserver<SettingsSnapshot> | undefined;
		const unsubscribe = vi.fn();
		preferences.connect({
			subscribe(_topic, _schema, next) {
				observer = next as PluginStateObserver<SettingsSnapshot>;
				return unsubscribe;
			},
		});
		await entered.promise;
		expect(observer).toBeDefined();
		observer!.updated(snapshot(3, 'dark'));
		const response = Response.json(snapshot(2, 'light'));
		const json = response.json.bind(response);
		response.json = async () => {
			const value = await json();
			parsed.resolve();
			return value;
		};
		read.resolve(response);
		await parsed.promise;
		await Promise.resolve();
		expect(preferences.value.value.theme).toBe('dark');
		preferences.disconnect();
		observer!.updated(snapshot(4, 'light'));
		expect(preferences.value.value.theme).toBe('dark');
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it('首次登录持久化浏览器语言，并接收恢复后的语言', async () => {
		let current = snapshot(0, 'system');
		const initialized = Promise.withResolvers<void>();
		const fetch = vi.fn<typeof globalThis.fetch>(async (_input, options) => {
			if (options?.method === 'POST') {
				expect(JSON.parse(String(options.body))).toEqual({ locale: 'zh' });
				current = { revision: 1, preferences: { ...defaultSettings, locale: 'zh' } };
				initialized.resolve();
			}
			return Response.json(current);
		});
		vi.stubGlobal('fetch', fetch);
		const preferences = new SettingsPreferencesApi({ locale: 'zh', log: { report: vi.fn() } });
		let observer!: PluginStateObserver<SettingsSnapshot>;
		preferences.connect({
			subscribe(_topic, _schema, next) {
				observer = next as PluginStateObserver<SettingsSnapshot>;
				return () => {};
			},
		});
		try {
			await initialized.promise;
			await vi.waitFor(() => expect(preferences.value.value.locale).toBe('zh'));
			observer.updated({ revision: 2, preferences: { ...defaultSettings, locale: 'en' } });
			expect(preferences.value.value.locale).toBe('en');
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
			expect(fetch.mock.calls.map(([, options]) => options?.method ?? 'GET')).toEqual(['GET', 'POST']);
		} finally {
			preferences.disconnect();
		}
	});

	it('迟到的首次语言初始化响应不会覆盖已经恢复的偏好', async () => {
		const entered = Promise.withResolvers<void>();
		const initialize = Promise.withResolvers<Response>();
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof globalThis.fetch>(async (_input, options) => {
				if (options?.method === 'POST') {
					entered.resolve();
					return initialize.promise;
				}
				return Response.json(snapshot(0, 'system'));
			}),
		);
		const preferences = new SettingsPreferencesApi({ locale: 'zh', log: { report: vi.fn() } });
		let observer!: PluginStateObserver<SettingsSnapshot>;
		preferences.connect({
			subscribe(_topic, _schema, next) {
				observer = next as PluginStateObserver<SettingsSnapshot>;
				return () => {};
			},
		});
		try {
			await entered.promise;
			observer.updated(snapshot(3, 'dark'));
			initialize.resolve(Response.json({ revision: 1, preferences: { ...defaultSettings, locale: 'zh' } }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(preferences.value.value.locale).toBe('en');
			expect(preferences.value.value.theme).toBe('dark');
		} finally {
			preferences.disconnect();
		}
	});

	it('保存响应丢失时读取已提交结果，避免重放写入和错误通知', async () => {
		let current = snapshot(1, 'system');
		const verified = Promise.withResolvers<void>();
		const fetch = vi.fn<typeof globalThis.fetch>(async (_input, options) => {
			if (options?.method === 'PATCH') {
				current = snapshot(2, 'dark');
				throw new TypeError('connection interrupted');
			}
			const response = Response.json(current);
			if (current.revision === 2) {
				const json = response.json.bind(response);
				response.json = async () => {
					const value = await json();
					verified.resolve();
					return value;
				};
			}
			return response;
		});
		vi.stubGlobal('fetch', fetch);
		const { preferences, log } = session();
		preferences.connect();
		preferences.update({ theme: 'dark' });
		expect(preferences.value.value.theme).toBe('dark');
		await verified.promise;
		await Promise.resolve();
		await Promise.resolve();
		expect(fetch.mock.calls.map(([, options]) => options?.method ?? 'GET')).toEqual(['GET', 'PATCH', 'GET']);
		expect(preferences.value.value.theme).toBe('dark');
		expect(log.report).not.toHaveBeenCalled();
		preferences.disconnect();
		expect(preferences.value.value.theme).toBe('dark');
	});

	it('退出后修改登录页语言，再登录时重新确认同一版本的服务端偏好', async () => {
		const persisted = {
			revision: 5,
			preferences: { ...defaultSettings, locale: 'zh' as const, theme: 'dark' as const },
		};
		const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(persisted));
		vi.stubGlobal('fetch', fetch);
		const { preferences } = session();
		try {
			preferences.connect();
			await vi.waitFor(() => expect(preferences.value.value.locale).toBe('zh'));
			preferences.disconnect();
			preferences.update({ locale: 'en' });
			expect(preferences.value.value.locale).toBe('en');
			preferences.connect();
			await vi.waitFor(() => expect(preferences.value.value.locale).toBe('zh'));
			expect(preferences.value.value.theme).toBe('dark');
			expect(fetch.mock.calls.map(([, options]) => options?.method ?? 'GET')).toEqual(['GET', 'GET']);
		} finally {
			preferences.disconnect();
		}
	});

	it('保存时使用提交当时的偏好值，调用方随后修改对象不会改变请求', async () => {
		const sent = Promise.withResolvers<string>();
		const fetch = vi.fn<typeof globalThis.fetch>(async (_input, options) => {
			if (options?.method === 'PATCH') {
				sent.resolve(String(options.body));
				return Response.json(snapshot(2, 'dark'));
			}
			return Response.json(snapshot(1, 'system'));
		});
		vi.stubGlobal('fetch', fetch);
		const { preferences } = session();
		preferences.connect();
		const patch: { theme: SettingsSnapshot['preferences']['theme'] } = { theme: 'dark' };
		preferences.update(patch);
		patch.theme = 'light';
		expect(JSON.parse(await sent.promise)).toMatchObject({ theme: 'dark' });
		preferences.disconnect();
	});
});
