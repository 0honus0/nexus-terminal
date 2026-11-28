import { version as hostVersion } from '../../../package.json' with { type: 'json' };
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { App } from '../../../src/app/node/app.js';
import { PluginRuntime } from '../../../src/plugin/plugin-api.node.js';
import { PluginTestHost } from './plugin-test-host.js';

function gate<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function setup(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-plugin-runtime-'));
	const host = new PluginTestHost({ dataDirectory: join(directory, 'data'), logLevel: 'fatal' });
	t.after(async () => {
		try {
			await host.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	await host.initialize();
	return { directory, runtime: host.runtime };
}

async function writePlugin(
	root: string,
	name: string,
	source: string,
	{ version = '1.0.0', dependsOn = {} }: { version?: string; dependsOn?: Record<string, string> } = {},
): Promise<string> {
	const directory = join(root, name);
	await mkdir(directory, { recursive: true });
	await Promise.all([
		writeFile(join(directory, 'index.mjs'), source),
		writeFile(
			join(directory, 'package.json'),
			JSON.stringify({
				name,
				version,
				type: 'module',
				peerDependencies: { 'nexus-terminal': '^' + hostVersion },
				nexus: { kind: 'extension', entry: { backend: 'index.mjs' }, dependsOn },
			}),
		),
	]);
	return directory;
}

test('批量启动保留受阻请求，并按重载后的版本和依赖重新调度', async (t) => {
	const { directory, runtime } = await setup(t);
	const providerId = '@test/provider';
	const consumerId = '@test/consumer';
	const independentId = '@test/independent';
	const activate = `import assert from 'node:assert/strict';
		export function activate({ app, authMethods }) {
			assert.deepEqual(Object.keys(app).sort(), ['crypto', 'database', 'http', 'log', 'state', 'ws']);
			assert.equal(authMethods, undefined);
		}`;
	const provider = await writePlugin(
		directory,
		providerId,
		'export function activate() { throw new Error("failed"); }',
	);
	const consumer = await writePlugin(directory, consumerId, activate, { dependsOn: { [providerId]: '^1.0.0' } });
	const independent = await writePlugin(directory, independentId, activate);

	const builtinId = '@test/builtin';
	await runtime.startBuiltins([
		{
			id: builtinId,
			version: '1.0.0',

			activate() {},
		},
	]);
	await assert.rejects(runtime.stop(builtinId), { code: 'PLUGIN_BUILTIN_MANAGED_BY_HOST' });
	await assert.rejects(runtime.reload(builtinId), { code: 'PLUGIN_BUILTIN_MANAGED_BY_HOST' });

	await runtime.start([consumer, provider, independent]);
	assert.equal(runtime.get(providerId)?.runtime, 'failed');
	assert.equal(runtime.get(consumerId)?.runtime, 'stopped');
	assert.equal(runtime.get(independentId)?.runtime, 'running');

	await writePlugin(directory, providerId, activate, { version: '1.1.0' });
	await runtime.reload(providerId);
	assert.equal(runtime.get(providerId)?.version, '1.1.0');
	assert.equal(runtime.get(consumerId)?.runtime, 'running');

	await writePlugin(directory, providerId, activate, { dependsOn: { [consumerId]: '^1.0.0' } });
	await assert.rejects(runtime.reload(providerId), { code: 'PLUGIN_DEPENDENCY_CYCLE' });
	assert.equal(runtime.get(providerId)?.runtime, 'failed');
	assert.equal(runtime.get(independentId)?.runtime, 'running');

	await writePlugin(directory, providerId, activate, { version: '1.2.0' });
	await runtime.reload(providerId);
	assert.equal(runtime.get(providerId)?.runtime, 'running');
	assert.equal(runtime.get(providerId)?.version, '1.2.0');
});

test('能力绑定失败后撤销作用域并等待已登记的清理', { timeout: 5000 }, async (t) => {
	const failure = new Error('BIND_FAILED');
	const cleaning = gate<AbortSignal>();
	const resume = gate();
	const directory = await mkdtemp(join(tmpdir(), 'nexus-plugin-binding-'));
	const services = {
		auth: { bindMethods: () => assert.fail('普通插件无需登录方式接口') },
		database: {
			async migratePlugin() {
				assert.fail('绑定失败后不能进入迁移');
			},
		},
		log: { report() {} },
		state: { register: () => ({ publish() {} }) },
	};
	const runtime = new PluginRuntime({
		app: {
			bind(_ownerId, scope) {
				scope.onDispose(async () => {
					cleaning.resolve(scope.signal);
					await resume.promise;
				});
				throw failure;
			},
		},
		services: {
			get<K extends keyof typeof services>(key: K): (typeof services)[K] {
				return services[key];
			},
		},
	});
	t.after(async () => {
		try {
			await runtime.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	const plugin = await writePlugin(directory, '@test/binding', 'export function activate() {}');
	let settled = false;
	const rejected = assert
		.rejects(runtime.start([plugin]), (cause) => cause === failure)
		.finally(() => {
			settled = true;
		});

	try {
		const signal = await Promise.race([cleaning.promise, rejected]);
		assert.ok(signal?.aborted);
		await setImmediate();
		assert.equal(settled, false);
	} finally {
		resume.resolve();
		await rejected;
	}
	assert.equal(runtime.get('@test/binding')?.runtime, 'failed');
});

test('App 等插件清理完成后再关闭宿主数据库', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-plugin-shutdown-'));
	const app = new App({ dataDirectory: join(directory, 'data'), logLevel: 'fatal' });
	t.after(async () => {
		try {
			await app.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await assert.rejects(app.startExternalPlugins([directory]), { code: 'SERVICE_NOT_READY' });
	await app.initialize();
	await app.startBuiltinPlugins();
	assert.equal('pluginApp' in app.services, false);

	const hooksPath = join(directory, 'hooks.mjs');
	await writeFile(hooksPath, 'export const hooks = {};');
	const hooksUrl = pathToFileURL(hooksPath).href;
	const plugin = await writePlugin(
		directory,
		'@test/shutdown',
		`import { hooks } from ${JSON.stringify(hooksUrl)};
		export function activate({ onDispose }) { onDispose(() => hooks.disposed()); }
		export function deactivate({ signal }) { return hooks.cleanup(signal); }`,
	);

	const database = app.services.get('database');
	const { hooks } = (await import(hooksUrl)) as {
		hooks: { cleanup(signal: AbortSignal): Promise<void>; disposed(): void };
	};
	const shutdown: string[] = [];
	hooks.cleanup = async (signal) => {
		assert.equal(signal.aborted, true);
		await database.withClient(() => undefined);
		shutdown.push('deactivate');
	};
	hooks.disposed = () => {
		shutdown.push('onDispose');
	};

	await app.startExternalPlugins([plugin]);
	await app.close();
	assert.deepEqual(shutdown, ['deactivate', 'onDispose']);
	await assert.rejects(
		database.withClient(() => undefined),
		{ code: 'DATABASE_CLOSED' },
	);
});

test('未完成激活的实例仍清理资源，停用后取得的资源也会释放', { timeout: 5000 }, async (t) => {
	const { directory, runtime } = await setup(t);
	const failure = new Error('ACTIVATE_FAILED');
	const failures: string[] = [];
	await assert.rejects(
		runtime.startBuiltins([
			{
				id: '@test/failed',
				version: '1.0.0',

				activate({ onDispose }) {
					onDispose(() => {
						failures.push('cleanup');
					});
					throw failure;
				},

				deactivate() {
					failures.push('deactivate');
				},
			},
		]),
		(cause) => cause === failure,
	);
	assert.deepEqual(failures, ['cleanup']);

	const entered = gate();
	const release = gate();
	const cleaned = gate<AbortSignal>();
	const hooksPath = join(directory, 'hooks.mjs');
	await writeFile(hooksPath, 'export const hooks = {};');
	const hooksUrl = pathToFileURL(hooksPath).href;
	const { hooks } = (await import(hooksUrl)) as {
		hooks: { entered(): void; release: Promise<void>; cleaned(signal: AbortSignal): void };
	};
	Object.assign(hooks, { entered: entered.resolve, release: release.promise, cleaned: cleaned.resolve });
	const pluginId = '@test/late-resource';
	const plugin = await writePlugin(
		directory,
		pluginId,
		`import { hooks } from ${JSON.stringify(hooksUrl)};
		export async function activate({ signal, onDispose }) {
			hooks.entered();
			await hooks.release;
			onDispose(() => hooks.cleaned(signal));
		}
		export function deactivate() { throw new Error('UNEXPECTED_DEACTIVATE'); }`,
	);

	const starting = assert.rejects(runtime.start([plugin]), { code: 'PLUGIN_CONTEXT_EXPIRED' });
	try {
		await Promise.race([entered.promise, starting]);
		await runtime.stop(pluginId);
		await starting;
	} finally {
		release.resolve();
	}
	assert.equal((await cleaned.promise).aborted, true);
	assert.equal(runtime.get(pluginId)?.runtime, 'stopped');
});

test('停用取消进行中的重载，等待下游清理，恢复时重新绑定', async (t) => {
	const { directory, runtime } = await setup(t);
	const providerId = '@test/provider';
	const consumerId = '@test/consumer';
	const hooksPath = join(directory, 'hooks.mjs');
	await writeFile(hooksPath, 'export const hooks = { events: [] };');
	const hooksUrl = pathToFileURL(hooksPath).href;
	interface Service {
		read(): string;
	}
	const { hooks } = (await import(hooksUrl)) as {
		hooks: { events: string[]; bound(service: Service): void; cleanup(): Promise<void> };
	};
	const bound = gate<Service>();
	const cleaning = gate();
	const resume = gate();
	hooks.bound = bound.resolve;
	hooks.cleanup = async () => {
		hooks.events.push('consumer cleanup');
		cleaning.resolve();
		await resume.promise;
	};

	const provider = await writePlugin(
		directory,
		providerId,
		`import { hooks } from ${JSON.stringify(hooksUrl)};
		export function activate(ctx) {
			ctx.provide('store', { read: () => 'value' });
			ctx.self.readiness.set({ state: 'ready' });
		}
		export function deactivate() { hooks.events.push('provider cleanup'); }`,
	);
	const consumer = await writePlugin(
		directory,
		consumerId,
		`import { hooks } from ${JSON.stringify(hooksUrl)};
		export function activate(ctx) {
			ctx.use({ store: ['@test/provider', 'store'] }, (scope) => {
				scope.onDispose(() => hooks.cleanup());
				hooks.bound(scope.plugin.store);
			});
		}`,
		{ dependsOn: { [providerId]: '^1.0.0' } },
	);

	try {
		await runtime.start([consumer, provider]);
		const original = await bound.promise;
		assert.equal(original.read(), 'value');

		const reloading = runtime.reload(providerId);
		await Promise.race([cleaning.promise, reloading]);
		const stopping = runtime.stop(providerId);
		assert.equal(runtime.stop(providerId), stopping);
		assert.equal(runtime.get(providerId)?.runtime, 'stopping');
		assert.throws(() => original.read(), { code: 'PLUGIN_SERVICE_EXPIRED' });
		assert.deepEqual(hooks.events, ['consumer cleanup']);

		const cancelled = assert.rejects(reloading, { code: 'PLUGIN_CONTEXT_EXPIRED' });
		resume.resolve();
		await Promise.all([cancelled, stopping]);
		assert.deepEqual(hooks.events, ['consumer cleanup', 'provider cleanup']);
		assert.equal(runtime.get(providerId)?.runtime, 'stopped');
		assert.equal(runtime.get(consumerId)?.runtime, 'running');

		const rebound = gate<Service>();
		hooks.bound = rebound.resolve;
		await runtime.reload(providerId);
		assert.equal((await rebound.promise).read(), 'value');
		assert.throws(() => original.read(), { code: 'PLUGIN_SERVICE_EXPIRED' });
	} finally {
		resume.resolve();
	}
});
