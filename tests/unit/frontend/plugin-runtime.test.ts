import { WindowLauncher } from '../../../src/window/browser/window-plugin-api.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectScope, nextTick, ref, shallowRef, watch } from 'vue';
import { z } from 'zod';
import { PluginScope } from '../../../src/plugin/plugin-api.js';
import type { StateClient } from '../../../src/state/browser/state-api.js';
import { HttpClientService } from '../../../src/http/browser/http-plugin-client-api.js';
import { StateClientService } from '../../../src/state/browser/state-plugin-client-api.js';
import { TaskService } from '../../../src/task/browser/task-plugin-api.js';
import { WsClientService } from '../../../src/ws/browser/ws-plugin-client-api.js';
import type { LogInput } from '../../../src/log/browser/log-api.js';
import { PluginViewScope } from '../../../src/plugin/browser/plugin-view-api.js';
import {
	PluginAppService,
	PluginRuntime,
	type BrowserPluginTarget,
	type PluginModuleApi,
} from '../../../src/plugin/plugin-api.browser.js';

declare module 'nexus-terminal/browser' {
	interface PluginServicesApi {
		'@test/provider': { service: { read(): string } };
	}
}

const component = () => null;

function fixture(id: string, module: PluginModuleApi, dependsOn: Record<string, string> = {}): BrowserPluginTarget {
	return {
		id,
		version: '1.0.0',
		enabled: true,
		dependsOn,

		load: async () => module,
	};
}

function setup() {
	const events: LogInput[] = [];
	const log = {
		bind: () => ({
			report() {},

			registerMessages: () => () => {},
		}),

		report: (event: LogInput) => {
			events.push(event);
		},
	};
	const windows = new WindowLauncher();
	const runtime = new PluginRuntime({
		app: new PluginAppService({
			http: new HttpClientService(),
			log,
			state: new StateClientService(() => undefined, log),
			tasks: new TaskService(log),
			ws: new WsClientService(),
			windows,
		}),
		services: { log },
	});
	return { runtime, events, windows };
}

function gate<Value = void>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((done) => {
		resolve = done;
	});
	return { resolve, promise };
}

test('插件停用取消等待中的视图关闭检查，迟到后不调用下一个检查', async (t) => {
	const { runtime } = setup();
	t.after(() => runtime.close());
	await runtime.sync([
		fixture('@test/view', {
			activate(context) {
				context.contribute({ applications: [{ id: 'main', label: 'View', component }] });
			},
		}),
	]);
	const entry = runtime.contributions.value.find((item) => 'component' in item && item.kind === 'applications');
	assert.ok(entry && 'component' in entry);
	const released = gate();
	const checking = gate();
	const disposed: string[] = [];
	const view = new PluginViewScope(entry, { report() {} }, (forced) => disposed.push(forced ? 'forced' : 'closed'));
	view.onDispose(() => {
		disposed.push('disposed');
	});
	view.onBeforeClose(async () => {
		checking.resolve();
		await released.promise;
	});
	view.onBeforeClose(() => {
		disposed.push('late');
	});
	const closing = view.requestClose();
	await checking.promise;
	try {
		await runtime.sync([]);
		assert.equal(await closing, true);
		assert.deepEqual(disposed, ['forced', 'disposed']);
	} finally {
		released.resolve();
	}
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(disposed, ['forced', 'disposed']);
});

test('后端待就绪仍可显示组件，依赖可用后交付服务并回收 Vue 副作用', { timeout: 5000 }, async (t) => {
	const { runtime } = setup();
	t.after(() => runtime.close());
	const count = ref(0);
	const saw: number[] = [];
	const binding = gate<{ service: { read(): string }; signal: AbortSignal }>();
	const disposed = gate();
	let consumerActivations = 0;
	const provider = fixture('@test/provider', {
		activate(context) {
			context.contribute({ applications: [{ id: 'main', label: 'Provider', component }] });
			context.provide('service', { read: () => 'service' });
			context.self.readiness.set({ state: 'ready' });
		},
	});
	const consumer = fixture(
		'@test/consumer',
		{
			activate(context) {
				consumerActivations++;
				context.use({ provider: ['@test/provider', 'service'] }, (scope) => {
					watch(count, (value) => saw.push(value), { flush: 'sync' });
					scope.onDispose(() => disposed.resolve());
					binding.resolve({ service: scope.plugin.provider, signal: scope.signal });
				});
			},
		},
		{ '@test/provider': '^1.0.0' },
	);

	const pending: BrowserPluginTarget = {
		...provider,
		backend: { runtime: 'running', readiness: { state: 'pending' } },
	};
	await runtime.sync([consumer, pending]);
	assert.equal(runtime.contributions.value[0]?.context.self.id, '@test/provider');
	assert.equal(runtime.contributions.value[0]?.context.self.backend?.readiness.state, 'pending');
	assert.deepEqual(saw, []);
	assert.equal(runtime.contributions.value.length, 1);

	const ready: BrowserPluginTarget = {
		...provider,
		backend: { runtime: 'running', readiness: { state: 'ready' } },
	};
	await runtime.sync([consumer, ready]);
	const { service, signal } = await binding.promise;
	assert.equal(service.read(), 'service');
	count.value = 1;
	assert.deepEqual(saw, [1]);

	const revoked = runtime.sync([consumer, pending]);
	assert.equal(signal.aborted, true);
	assert.throws(() => service.read(), { code: 'PLUGIN_SERVICE_EXPIRED' });
	await revoked;
	await disposed.promise;
	count.value = 2;
	assert.deepEqual(saw, [1]);
	assert.equal(consumerActivations, 1);
	assert.equal(runtime.contributions.value.length, 1);
});

test('停用不等待迟到的激活结果，晚到的资源仍会释放', { timeout: 5000 }, async (t) => {
	const { runtime } = setup();
	t.after(() => runtime.close());
	const entered = gate<AbortSignal>();
	const release = gate();
	const cleaned = gate();
	const target = fixture('@test/late', {
		async activate(context) {
			context.contribute({ widgets: [{ id: 'staged', label: 'Late', component }] });
			entered.resolve(context.signal);
			await release.promise;
			context.onDispose(() => cleaned.resolve());
			assert.throws(() => context.contribute({}), { code: 'PLUGIN_CONTEXT_EXPIRED' });
		},

		deactivate() {
			assert.fail('未完成激活的实例不能调用 deactivate');
		},
	});
	const starting = runtime.sync([target]);
	try {
		const signal = await entered.promise;
		assert.deepEqual(runtime.contributions.value, []);
		await runtime.sync([]);
		assert.equal(signal.aborted, true);
		await starting;
	} finally {
		release.resolve();
	}
	await cleaned.promise;
	assert.deepEqual(runtime.contributions.value, []);
});

test('同一插件贡献重复时回滚整批，并继续加载无关插件', async (t) => {
	const { runtime, events } = setup();
	t.after(() => runtime.close());
	let released = false;
	const contribution = { id: 'main', label: 'Main', component };
	const faulty = fixture('@test/faulty', {
		activate(context) {
			context.onDispose(() => {
				released = true;
			});
			context.contribute({ widgets: [contribution, contribution] });
		},
	});
	const independent = fixture('@test/other', {
		activate(context) {
			context.contribute({ widgets: [contribution] });
		},
	});
	await runtime.sync([faulty, independent]);
	assert.equal(released, true);
	assert.deepEqual(
		runtime.contributions.value.map(({ context }) => context.self.id),
		[independent.id],
	);
	assert.ok(events.some(({ code, pluginId }) => code === 'PLUGIN_START_FAILED' && pluginId === faulty.id));
});

test('清单引入环时撤销受影响实例，解除后恢复，独立实例继续使用原贡献', async (t) => {
	const { runtime, events } = setup();
	t.after(() => runtime.close());
	const source = ref(0);
	const saw: number[] = [];
	const module: PluginModuleApi = {
		activate(context) {
			if (context.self.id === '@test/first') watch(source, (value) => saw.push(value), { flush: 'sync' });
			context.contribute({ widgets: [{ id: 'main', label: 'Widget', component }] });
		},
	};
	const first = fixture('@test/first', module);
	const second = fixture('@test/second', module, { [first.id]: '*' });
	const independent = fixture('@test/independent', module);
	await runtime.sync([independent, second, first]);
	const retained = runtime.contributions.value.find(({ context }) => context.self.id === independent.id);
	assert.ok(retained);
	source.value = 1;

	await runtime.sync([independent, second, { ...first, dependsOn: { [second.id]: '*' } }]);
	source.value = 2;
	assert.deepEqual(saw, [1]);
	assert.deepEqual(runtime.contributions.value, [retained]);
	for (const id of [first.id, second.id]) {
		assert.ok(events.some(({ code, pluginId }) => code === 'PLUGIN_DEPENDENCY_CYCLE' && pluginId === id));
	}

	await runtime.sync([independent, second, first]);
	source.value = 3;
	assert.deepEqual(saw, [1, 3]);
	assert.equal(runtime.contributions.value.length, 3);
	assert.equal(
		runtime.contributions.value.find(({ context }) => context.self.id === independent.id),
		retained,
	);
});

test('宿主状态主题在同一插件内复用订阅，并随视图和连接变更撤销', async () => {
	const scopes = new PluginScope(() => {});
	let publish: ((value: unknown) => void) | undefined;
	let subscriptions = 0;
	let releases = 0;
	const client = {
		subscribe(topic, schema, observer) {
			assert.deepEqual(topic, { pluginId: '@test/consumer', name: 'items' });
			subscriptions++;
			publish = (value) => observer.updated(schema.parse(value));
			return () => {
				releases++;
			};
		},
	} satisfies Pick<StateClient, 'subscribe'>;
	const current = shallowRef<Pick<StateClient, 'subscribe'> | undefined>(client);
	const state = new StateClientService(() => current.value, { report() {} }).bind('@test/consumer', scopes);
	const observed: number[] = [];
	const view = new AbortController();
	state.subscribe('items', z.number(), { updated: (value) => observed.push(value) }, view.signal);
	publish?.(1);
	state.subscribe('items', z.number(), { updated: (value) => observed.push(value * 10) });
	assert.deepEqual(observed, [1, 10]);
	assert.equal(subscriptions, 1);

	view.abort();
	publish?.(2);
	assert.deepEqual(observed, [1, 10, 20]);
	current.value = undefined;
	await nextTick();
	assert.equal(releases, 1);
	current.value = client;
	await nextTick();
	assert.equal(subscriptions, 2);

	const payload = { count: 3 };
	state.subscribe('items', z.unknown(), {
		updated(value) {
			(value as typeof payload).count = 99;
		},
	});
	const cloned: number[] = [];
	state.subscribe('items', z.object({ count: z.number() }), { updated: ({ count }) => cloned.push(count) });
	publish?.(payload);
	assert.deepEqual(cloned, [3]);
	assert.deepEqual(payload, { count: 3 });
	await scopes.close();
	assert.equal(releases, 2);
});

test('首个状态订阅视图卸载后，其他视图继续接收共享主题', async (t) => {
	const plugin = new PluginScope(() => {});
	const tile = effectScope();
	const window = effectScope();
	t.after(async () => {
		tile.stop();
		window.stop();
		await plugin.close();
	});
	const tileLifetime = new AbortController();
	const windowLifetime = new AbortController();
	let publish: ((value: unknown) => void) | undefined;
	let subscriptions = 0;
	let releases = 0;
	const client = {
		subscribe(_topic, schema, observer) {
			subscriptions++;
			publish = (value) => observer.updated(schema.parse(value));
			return () => {
				publish = undefined;
				releases++;
			};
		},
	} satisfies Pick<StateClient, 'subscribe'>;
	const current = shallowRef<Pick<StateClient, 'subscribe'> | undefined>(client);
	const state = new StateClientService(() => current.value, { report() {} }).bind('@test/consumer', plugin);
	const observed: number[] = [];
	tile.run(() => state.subscribe('items', z.number(), { updated() {} }, tileLifetime.signal));
	window.run(() =>
		state.subscribe('items', z.number(), { updated: (value) => observed.push(value) }, windowLifetime.signal),
	);
	publish?.(1);
	tileLifetime.abort();
	tile.stop();
	assert.equal(subscriptions, 1);
	assert.equal(releases, 0);
	publish?.(2);
	assert.deepEqual(observed, [1, 2]);
	current.value = undefined;
	await nextTick();
	assert.equal(releases, 1);
	current.value = client;
	await nextTick();
	assert.equal(subscriptions, 2);
	publish?.(3);
	assert.deepEqual(observed, [1, 2, 3]);
	windowLifetime.abort();
	window.stop();
	assert.equal(releases, 2);
});

test('与视图关联的重要任务等待完成，失败保留窗口，强制关闭取消任务', async () => {
	const { runtime } = setup();
	const id = '@test/tasks';
	await runtime.sync([
		fixture(id, {
			activate(context) {
				context.contribute({ applications: [{ id: 'view', label: 'View', component }] });
			},
		}),
	]);
	const entry = runtime.contributions.value.find((item) => item.kind === 'applications');
	assert.ok(entry && entry.kind === 'applications');
	const view = new PluginViewScope(entry, { report() {} }, () => {});
	const waiting = gate();
	const work = entry.context.app.tasks.run(
		async () => {
			await waiting.promise;
			throw new Error('test failure');
		},
		{ view: view.api },
	);
	const closing = view.requestClose();
	await nextTick();
	waiting.resolve();
	await assert.rejects(work, /test failure/u);
	assert.equal(await closing, false);
	assert.equal(view.signal.aborted, false);

	const entered = gate();
	const pending = entry.context.app.tasks.run(
		async (signal) => {
			entered.resolve();
			await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
		},
		{ view: view.api },
	);
	const rejected = assert.rejects(pending, { code: 'PLUGIN_CONTEXT_EXPIRED' });
	await entered.promise;
	await view.close();
	await rejected;
	await runtime.close();
});

test('SDK 窗口入口绑定当前插件，桌面拆除和插件停用后拒绝打开', async (t) => {
	const { runtime, windows } = setup();
	t.after(() => runtime.close());
	let open!: (id: string) => void;
	await runtime.sync([
		fixture('@test/owner', {
			activate(context) {
				open = context.app.windows.open;
				context.contribute({ applications: [{ id: 'main', label: 'Owner', component }] });
			},
		}),
	]);
	let target: string | undefined;
	const detach = windows.attach((key) => {
		target = key;
		return key === '@test/owner:applications:main';
	});
	open('main');
	assert.equal(target, '@test/owner:applications:main');
	assert.throws(() => open('@test/another:applications:main'), { code: 'PLUGIN_APPLICATION_UNAVAILABLE' });
	detach();
	assert.throws(() => open('main'), { code: 'PLUGIN_APPLICATION_UNAVAILABLE' });
	await runtime.sync([]);
	assert.throws(() => open('main'));
});

test('状态共享订阅切换后拒绝旧客户端的迟到通知', async (t) => {
	const plugin = new PluginScope(() => {});
	t.after(() => plugin.close());
	const callbacks: ((value: unknown) => void)[] = [];

	const fixtureClient = () =>
		({
			subscribe(_topic, schema, observer) {
				callbacks.push((value) => observer.updated(schema.parse(value)));
				return () => {};
			},
		}) satisfies Pick<StateClient, 'subscribe'>;

	const current = shallowRef<Pick<StateClient, 'subscribe'>>(fixtureClient());
	const state = new StateClientService(() => current.value, { report() {} }).bind('@test/consumer', plugin);
	const observed: number[] = [];
	state.subscribe('items', z.number(), { updated: (value) => observed.push(value) });
	callbacks[0]!(1);
	current.value = fixtureClient();
	callbacks[0]!(2);
	await nextTick();
	callbacks[1]!(3);
	callbacks[0]!(4);
	assert.deepEqual(observed, [1, 3]);
});

test('首次共享状态订阅失败后不遗留监听作用域', async (t) => {
	const plugin = new PluginScope(() => {});
	t.after(() => plugin.close());
	let calls = 0;
	let releases = 0;

	const makeClient = () =>
		({
			subscribe() {
				if (++calls === 1) throw new Error('fixture subscribe failure');
				return () => {
					releases++;
				};
			},
		}) satisfies Pick<StateClient, 'subscribe'>;

	const current = shallowRef<Pick<StateClient, 'subscribe'>>(makeClient());
	const state = new StateClientService(() => current.value, { report() {} }).bind('@test/consumer', plugin);
	assert.throws(() => state.subscribe('items', z.number(), { updated() {} }), /fixture subscribe failure/u);
	const release = state.subscribe('items', z.number(), { updated() {} });
	current.value = makeClient();
	await nextTick();
	assert.equal(calls, 3);
	release();
	assert.equal(releases, 2);
});
