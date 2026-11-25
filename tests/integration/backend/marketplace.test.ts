import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { on, once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { create as createArchive } from 'tar';
import jsonPatch from 'fast-json-patch';
import { WebSocket } from 'ws';
import { pluginTablePrefix } from '../../../src/database/node/database-api.js';
import { App } from '../../../src/app/node/app.js';
import {
	MarketplaceRepositorySchema,
	type PluginDistribution,
} from '../../../src/marketplace/marketplace-catalog-types.js';
import {
	MarketplaceCatalogListSchema,
	MarketplaceInstallAttemptsSchema,
	MarketplacePluginListSchema,
	MarketplaceRepositoryListSchema,
	MarketplaceRetainedDataListSchema,
	MarketplaceUninstallPlanSchema,
	MarketplaceRuntimeImpactSchema,
} from '../../../src/marketplace/marketplace-http-types.js';
import { MarketplaceInstallPlanSchema } from '../../../src/marketplace/marketplace-install-types.js';
import { planMarketplaceInstall } from '../../../src/marketplace/node/marketplace-install-planner.js';
import { MarketplaceStorage } from '../../../src/marketplace/node/marketplace-storage.js';
import {
	MarketplaceOperationSchema,
	MarketplaceOperationsSchema,
	MarketplaceOperationsTopic,
	MarketplacePluginId,
	type MarketplaceOperation,
} from '../../../src/marketplace/marketplace-types.js';
import { inspectPluginPackage } from '../../../src/plugin/plugin-api.node.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';
import type { PluginManifest } from '../../../src/plugin/plugin-manifest-types.js';
import { readPluginRuntime } from './plugin-test-host.js';
import { StateMessageSchema } from '../../../src/state/state-ws-types.js';

async function setup(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-marketplace-'));
	const options = { dataDirectory: join(directory, 'data'), logLevel: 'fatal' } as const;
	let app = new App(options);
	t.after(async () => {
		try {
			await app.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await app.initialize();
	await app.startBuiltinPlugins();
	await app.startExternalPlugins();

	return {
		directory,
		app,

		async restart({ initializeOnly = false } = {}) {
			await app.close();
			app = new App(options);
			await app.initialize();
			if (!initializeOnly) {
				await app.startBuiltinPlugins();
				await app.startExternalPlugins();
			}
			return app;
		},
	};
}

async function writePlugin(
	directory: string,
	pluginId: string,
	{
		version = '1.0.0',
		dependsOn = {},
		source = 'export function activate() {}',
		frontendOnly = false,
		displayName,
		icon,
		i18n,
	}: {
		version?: string;
		dependsOn?: Record<string, string>;
		source?: string;
		frontendOnly?: boolean;
		displayName?: string;
		icon?: string;
		i18n?: PluginManifest['nexus']['i18n'];
	} = {},
): Promise<string> {
	const path = join(directory, pluginId);
	await mkdir(path, { recursive: true });
	await Promise.all([
		writeFile(
			join(path, 'package.json'),
			JSON.stringify({
				name: pluginId,
				version,
				displayName,
				type: 'module',
				peerDependencies: { 'nexus-terminal': '^1.0.0' },
				nexus: {
					kind: 'extension',
					icon,
					entry: { [frontendOnly ? 'frontend' : 'backend']: 'index.mjs' },
					dependsOn,
					i18n,
				},
			}),
		),
		writeFile(join(path, 'index.mjs'), source),
	]);
	return path;
}

/** 安装执行接入前，由测试准备已安装记录。 */
async function recordInstalledPlugin(app: App, directory: string) {
	const target = await inspectPluginPackage(directory);
	const scope = new PluginScope(() => {});
	try {
		const database = app.services.get('database').bind(MarketplacePluginId, scope);
		return await new MarketplaceStorage(database).register(target);
	} finally {
		await scope.close();
	}
}

async function initializeOwner(origin: string): Promise<string> {
	const response = await fetch(`${origin}/api/auth/initialize`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'test', password: 'test-password' }),
	});
	assert.equal(response.status, 201);
	await response.arrayBuffer();
	const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
	assert.ok(cookie);
	return cookie;
}

const marketplacePath = `/api/plugins/${encodeURIComponent(MarketplacePluginId)}`;

const managerPath = marketplacePath + '/manager';

const repositoriesPath = marketplacePath + '/repositories';

const catalogPath = marketplacePath + '/plugins';

async function serveRepositories(t: TestContext) {
	const replies = new Map<string, (response: ServerResponse) => void>();
	const requests: { path: string; cookie: string | undefined }[] = [];
	const server = createServer((request, response) => {
		const path = request.url ?? '';
		requests.push({ path, cookie: request.headers.cookie });
		const reply = replies.get(path);
		if (reply) reply(response);
		else response.writeHead(404).end();
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => {
		server.closeAllConnections();
		return new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const origin = `http://127.0.0.1:${address.port}`;

	return {
		origin,
		replies,
		requests,

		publish(path: string, catalog: unknown) {
			replies.set(path, (response) =>
				response.setHeader('content-type', 'application/json').end(JSON.stringify(catalog)),
			);
			return origin + path;
		},
	};
}

function catalogEntry(
	id: string,
	origin: string,
	versions: {
		version?: string;
		dependsOn?: Record<string, string>;
		requiredFor?: string[];
		kind?: 'application' | 'extension';
		sdk?: string;
		distributions?: PluginDistribution[];
	}[] = [{}],
) {
	return {
		id,
		versions: versions.map(
			({ version = '1.0.0', dependsOn, requiredFor, kind = 'extension', sdk = '^1.0.0', distributions }) => ({
				repositoryId: 'publisher-controlled-id',
				package: {
					name: id,
					version,
					type: 'module',
					peerDependencies: { 'nexus-terminal': sdk },
					nexus: {
						kind,
						entry: { backend: 'index.mjs' },
						dependsOn,
						requiredFor,
						i18n: { zh: { description: '示例扩展' } },
					},
				},
				distributions: distributions ?? [{ tarball: origin + '/artifact.tgz', integrity: 'sha512-fixture' }],
			}),
		),
	};
}

function marketRequest(
	origin: string,
	path: string,
	cookie: string,
	method = 'GET',
	input?: object,
	signal?: AbortSignal,
) {
	return fetch(origin + path, {
		method,
		headers: input === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
		body: input === undefined ? undefined : JSON.stringify(input),
		signal,
	});
}

async function addRepository(origin: string, cookie: string, url: string) {
	const response = await marketRequest(origin, repositoriesPath, cookie, 'POST', { url });
	assert.equal(response.status, 201);
	return MarketplaceRepositorySchema.parse(await response.json());
}

async function listInstalledPlugins(origin: string, cookie: string) {
	const response = await marketRequest(origin, managerPath + '/plugins', cookie);
	assert.equal(response.status, 200);
	return MarketplacePluginListSchema.parse(await response.json()).items;
}

async function previewInstall(
	origin: string,
	cookie: string,
	repositoryId: string,
	pluginId: string,
	version = '1.0.0',
) {
	const response = await marketRequest(origin, managerPath + '/install-plan', cookie, 'POST', {
		kind: 'repository',
		repositoryId,
		pluginId,
		version,
	});
	assert.equal(response.status, 200);
	return MarketplaceInstallPlanSchema.parse(await response.json());
}

function setEnabled(
	origin: string,
	pluginId: string,
	cookie: string,
	input: object,
	observationId?: string,
	signal?: AbortSignal,
) {
	return marketRequest(
		origin,
		`${managerPath}/plugins/${encodeURIComponent(pluginId)}`,
		cookie,
		'PATCH',
		{
			...input,
			observationId,
		},
		signal,
	);
}

async function observeOperations(t: TestContext, origin: string, cookie: string) {
	const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/state/ws', { headers: { cookie } });
	t.after(() => socket.terminate());
	const messages = on(socket, 'message', { close: ['close'] });
	await once(socket, 'open');
	socket.send(JSON.stringify({ type: 'subscribe', topic: MarketplaceOperationsTopic }));
	let operations: MarketplaceOperation[] = [];

	return async (id: string): Promise<MarketplaceOperation> => {
		for (;;) {
			const frame = await messages.next();
			assert.ok(!frame.done, '操作完成前状态连接已关闭');
			const [raw] = frame.value;
			const message = StateMessageSchema.parse(JSON.parse(raw.toString()));
			assert.deepEqual(message.topic, MarketplaceOperationsTopic);
			assert.notEqual(message.type, 'unavailable');
			if (message.type === 'snapshot') operations = MarketplaceOperationsSchema.parse(message.state);
			if (message.type === 'patch') {
				operations = MarketplaceOperationsSchema.parse(
					jsonPatch.applyPatch(operations, message.changes).newDocument,
				);
			}
			const operation = operations.find((item) => item.id === id && item.finishedAt);
			if (operation) return operation;
		}
	};
}

test('市场由宿主登记为内置插件，运行时关闭时撤销市场路由和状态主题', { timeout: 10000 }, async (t) => {
	const { app, directory } = await setup(t);
	const replacement = await writePlugin(directory, MarketplacePluginId);
	await assert.rejects(app.startExternalPlugins([replacement]), { code: 'PLUGIN_BUILTIN_ID_RESERVED' });
	assert.deepEqual(Object.keys(app.services), ['get']);
	assert.equal('marketplace' in app, false);

	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const market = (await readPluginRuntime(origin, cookie)).find(({ pluginId }) => pluginId === MarketplacePluginId);
	assert.equal(market?.runtime, 'running');
	assert.equal(market?.readiness.state, 'ready');
	assert.deepEqual(await listInstalledPlugins(origin, cookie), []);
	assert.equal((await setEnabled(origin, MarketplacePluginId, cookie, { enabled: false })).status, 404);
	const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/state/ws', { headers: { cookie } });
	t.after(() => socket.terminate());
	const messages = on(socket, 'message', { close: ['close'] });
	await once(socket, 'open');

	const nextMessage = async () => {
		const frame = await messages.next();
		assert.ok(!frame.done);
		return StateMessageSchema.parse(JSON.parse(frame.value[0].toString()));
	};

	socket.send(JSON.stringify({ type: 'subscribe', topic: { name: MarketplaceOperationsTopic.name } }));
	assert.equal((await nextMessage()).type, 'unavailable');
	socket.send(JSON.stringify({ type: 'subscribe', topic: MarketplaceOperationsTopic }));
	assert.equal((await nextMessage()).type, 'snapshot');
	assert.equal((await marketRequest(origin, catalogPath, cookie)).status, 200);
	assert.equal((await marketRequest(origin, '/api/marketplace/plugins', cookie)).status, 404);

	await app.close();
	await assert.rejects(marketRequest(origin, catalogPath, cookie));
	assert.deepEqual(await nextMessage(), {
		type: 'unavailable',
		topic: MarketplaceOperationsTopic,
		code: 'STATE_TOPIC_UNAVAILABLE',
	});
});

test('安装记录持久化，市场列表和启停需要登录', { timeout: 10000 }, async (t) => {
	const { directory, app, restart } = await setup(t);
	const pluginId = '@test/managed';
	const path = await writePlugin(directory, pluginId, {
		displayName: 'Managed plugin',
		icon: 'wrench',
		i18n: { 'zh-CN': { displayName: '受管理插件' } },
	});
	await recordInstalledPlugin(app, path);

	let origin = app.services.get('http').origin;
	assert.equal((await fetch(`${origin}${managerPath}/plugins`)).status, 401);
	assert.equal((await setEnabled(origin, pluginId, '', { enabled: true })).status, 401);
	const cookie = await initializeOwner(origin);
	const installations = await listInstalledPlugins(origin, cookie);
	assert.deepEqual(installations, [
		{
			pluginId,
			version: '1.0.0',
			kind: 'extension',
			hasBackend: true,
			displayName: 'Managed plugin',
			icon: 'wrench',
			localizedNames: { 'zh-CN': '受管理插件' },
			source: { kind: 'local' },
			enabled: false,
			runtime: null,
			issue: null,
		},
	]);
	assert.equal((await setEnabled(origin, pluginId, cookie, { enabled: true, directory: path })).status, 400);
	assert.equal((await setEnabled(origin, pluginId, cookie, { enabled: true }, 'invalid')).status, 400);
	assert.equal((await setEnabled(origin, '@test/unknown', cookie, { enabled: true })).status, 404);

	const observe = await observeOperations(t, origin, cookie);
	const observationId = randomUUID();
	const enabled = await setEnabled(origin, pluginId, cookie, { enabled: true }, observationId);
	assert.equal(enabled.status, 202);
	const operation = MarketplaceOperationSchema.parse(await enabled.json());
	const finished = await observe(operation.id);
	assert.equal(finished.state, 'succeeded');
	assert.equal(finished.committed, true);
	const duplicate = await setEnabled(origin, pluginId, cookie, { enabled: true }, observationId);
	assert.equal(MarketplaceOperationSchema.parse(await duplicate.json()).id, operation.id);
	assert.equal((await setEnabled(origin, pluginId, cookie, { enabled: false }, observationId)).status, 409);
	const lookup = await fetch(`${origin}${managerPath}/operations/${operation.id}`, { headers: { cookie } });
	assert.deepEqual(MarketplaceOperationSchema.parse(await lookup.json()), finished);
	assert.equal((await listInstalledPlugins(origin, cookie))[0].enabled, true);

	const developerId = '@test/development';
	await app.startExternalPlugins([await writePlugin(directory, developerId)]);
	assert.equal(
		(await readPluginRuntime(origin, cookie)).find(({ pluginId }) => pluginId === developerId)?.runtime,
		'running',
	);
	assert.deepEqual(
		(await listInstalledPlugins(origin, cookie)).map(({ pluginId }) => pluginId),
		[pluginId],
	);

	const recovered = await restart({ initializeOnly: true });
	origin = recovered.services.get('http').origin;
	assert.equal(
		(await readPluginRuntime(origin, cookie)).find(({ pluginId }) => pluginId === MarketplacePluginId),
		undefined,
	);
	assert.equal((await marketRequest(origin, catalogPath, cookie)).status, 404);
	await assert.rejects(recovered.startExternalPlugins(), { code: 'SERVICE_NOT_READY' });

	await Promise.all([recovered.startBuiltinPlugins(), recovered.startBuiltinPlugins()]);
	assert.equal(
		(await readPluginRuntime(origin, cookie)).find(({ pluginId }) => pluginId === MarketplacePluginId)?.runtime,
		'running',
	);
	const [beforeRestore] = await listInstalledPlugins(origin, cookie);
	assert.equal(beforeRestore.enabled, true);
	assert.equal(beforeRestore.runtime, null);
	assert.deepEqual(beforeRestore.localizedNames, { 'zh-CN': '受管理插件' });

	await recovered.startExternalPlugins();
	assert.equal(
		(await readPluginRuntime(origin, cookie)).find(({ pluginId }) => pluginId === developerId),
		undefined,
	);
	const [item] = await listInstalledPlugins(origin, cookie);
	assert.equal(item.enabled, true);
	assert.equal(item.runtime?.runtime, 'running');
	assert.equal('directory' in item, false);

	const observeRecovered = await observeOperations(t, origin, cookie);
	const disabled = await setEnabled(origin, pluginId, cookie, { enabled: false });
	assert.equal(disabled.status, 202);
	assert.equal(
		(await observeRecovered(MarketplaceOperationSchema.parse(await disabled.json()).id)).state,
		'succeeded',
	);
	assert.equal((await listInstalledPlugins(origin, cookie))[0].runtime?.runtime, 'stopped');

	const next = await restart();
	assert.deepEqual(await listInstalledPlugins(next.services.get('http').origin, cookie), installations);
});

test('只有前端入口的插件可以启用并在重启后恢复安装意图', { timeout: 10000 }, async (t) => {
	const { directory, app, restart } = await setup(t);
	const pluginId = '@test/frontend-only';
	const plugin = await writePlugin(directory, pluginId, {
		frontendOnly: true,
		source: 'throw new Error("must not import in Node");',
	});
	await recordInstalledPlugin(app, plugin);
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const observe = await observeOperations(t, origin, cookie);
	const response = await setEnabled(origin, pluginId, cookie, { enabled: true });
	assert.equal(response.status, 202);
	const operation = await observe(MarketplaceOperationSchema.parse(await response.json()).id);
	assert.equal(operation.state, 'succeeded');
	assert.equal(operation.committed, true);
	const [installed] = await listInstalledPlugins(origin, cookie);
	assert.equal(installed.enabled, true);
	assert.equal(installed.runtime, null);
	assert.equal(installed.issue, null);

	const recovered = await restart();
	assert.deepEqual(await listInstalledPlugins(recovered.services.get('http').origin, cookie), [installed]);
});

test('恢复保留缺失、换包及激活失败的安装记录，并继续按依赖启动其余插件', { timeout: 10000 }, async (t) => {
	const { directory, app, restart } = await setup(t);
	const missing = await writePlugin(directory, '@test/missing');
	const replaced = await writePlugin(directory, '@test/replaced');
	const failing = await writePlugin(directory, '@test/failing', {
		source: 'export function activate() { throw new Error("fixture failure"); }',
	});
	const provider = await writePlugin(directory, '@test/provider');
	const dependent = await writePlugin(directory, '@test/dependent', {
		dependsOn: { '@test/provider': '^1.0.0' },
	});
	for (const path of [missing, replaced, failing, provider, dependent]) await recordInstalledPlugin(app, path);

	let origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	let observe = await observeOperations(t, origin, cookie);

	const changeEnabled = async (pluginId: string, enabled: boolean) => {
		const response = await setEnabled(origin, pluginId, cookie, { enabled });
		assert.equal(response.status, 202);
		return observe(MarketplaceOperationSchema.parse(await response.json()).id);
	};

	// 先让消费者进入等待，提供方启用后同一个运行时会继续启动它。
	await changeEnabled('@test/dependent', true);
	assert.equal(
		(await listInstalledPlugins(origin, cookie)).find(({ pluginId }) => pluginId === '@test/dependent')?.runtime
			?.runtime,
		'stopped',
	);
	await changeEnabled('@test/provider', true);
	await changeEnabled('@test/missing', true);
	await changeEnabled('@test/replaced', true);
	assert.equal((await changeEnabled('@test/failing', true)).error, 'MARKETPLACE_PLUGIN_START_FAILED');

	await rename(missing, join(directory, 'missing.offline'));
	await writePlugin(directory, '@test/replaced', { version: '2.0.0', source: 'throw new Error("must not import");' });

	const recovered = await restart();
	origin = recovered.services.get('http').origin;
	const rows = new Map((await listInstalledPlugins(origin, cookie)).map((row) => [row.pluginId, row]));
	assert.equal(rows.get('@test/missing')?.issue, 'MARKETPLACE_PACKAGE_MISSING');
	assert.equal(rows.get('@test/missing')?.enabled, true);
	assert.equal(rows.get('@test/replaced')?.issue, 'MARKETPLACE_PACKAGE_IDENTITY_MISMATCH');
	assert.equal(rows.get('@test/replaced')?.version, '1.0.0');
	assert.equal(rows.get('@test/replaced')?.runtime, null);
	assert.equal(rows.get('@test/failing')?.issue, 'MARKETPLACE_PLUGIN_START_FAILED');
	assert.equal(rows.get('@test/provider')?.runtime?.runtime, 'running');
	assert.equal(rows.get('@test/dependent')?.runtime?.runtime, 'running');
	observe = await observeOperations(t, origin, cookie);
	assert.equal((await changeEnabled('@test/missing', false)).state, 'succeeded');
	assert.equal(
		(await listInstalledPlugins(origin, cookie)).find(({ pluginId }) => pluginId === '@test/missing')?.enabled,
		false,
	);
});

test('市场在激活完成前返回 202，客户端关闭请求后宿主继续执行', { timeout: 10000 }, async (t) => {
	const { directory, app, restart } = await setup(t);
	const pluginId = '@test/slow';
	const hooksPath = join(directory, 'hooks.mjs');
	const hooksUrl = pathToFileURL(hooksPath).href;
	await writeFile(hooksPath, 'export const hooks = {};');
	const { hooks } = (await import(hooksUrl)) as { hooks: { wait(): Promise<void> } };
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();

	hooks.wait = async () => {
		entered.resolve();
		await release.promise;
	};

	await recordInstalledPlugin(
		app,
		await writePlugin(directory, pluginId, {
			source: `import { hooks } from ${JSON.stringify(hooksUrl)};
			export async function activate() { await hooks.wait(); }`,
		}),
	);
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const controller = new AbortController();
	const observe = await observeOperations(t, origin, cookie);
	let operation: MarketplaceOperation;

	try {
		const requested = await setEnabled(origin, pluginId, cookie, { enabled: true }, undefined, controller.signal);
		assert.equal(requested.status, 202);
		operation = MarketplaceOperationSchema.parse(await requested.json());
		await entered.promise;
		controller.abort();
		assert.equal((await listInstalledPlugins(origin, cookie))[0].enabled, true);
	} finally {
		release.resolve();
	}

	assert.equal((await observe(operation.id)).state, 'succeeded');
	assert.equal((await listInstalledPlugins(origin, cookie))[0].runtime?.runtime, 'running');
	const recovered = await restart();
	assert.equal(
		(await listInstalledPlugins(recovered.services.get('http').origin, cookie))[0].runtime?.runtime,
		'running',
	);
});

test('官方仓库只在本地登记一次，目录离线时保留缓存', { timeout: 10000 }, async (t) => {
	const url = 'https://raw.githubusercontent.com/0honus0/nexus-plugin/catalog/catalog.json';
	const manifest = catalogEntry('@test/official', 'https://example.test');
	const originalFetch = globalThis.fetch;
	let online = true;
	let requests = 0;
	t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		if (input !== url) return originalFetch(input, init);
		requests++;
		if (!online) throw new TypeError('offline');
		return Response.json([manifest]);
	});

	const { app, restart } = await setup(t);
	let origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);

	const repositories = async () =>
		MarketplaceRepositoryListSchema.parse(await (await marketRequest(origin, repositoriesPath, cookie)).json())
			.items;

	const catalog = async () =>
		MarketplaceCatalogListSchema.parse(await (await marketRequest(origin, catalogPath, cookie)).json()).items;

	const [official] = await repositories();
	assert.equal(official.url, url);
	assert.equal(official.official, true);
	assert.deepEqual(await catalog(), []);
	assert.equal(requests, 0);

	const path = `${repositoriesPath}/${official.id}`;
	assert.equal((await marketRequest(origin, path + '/refresh', cookie, 'POST')).status, 204);
	online = false;
	assert.equal((await marketRequest(origin, path + '/refresh', cookie, 'POST')).status, 502);
	assert.equal((await catalog())[0].versions[0].repositoryId, official.id);

	origin = (await restart()).services.get('http').origin;
	assert.deepEqual(await repositories(), [official]);
	assert.equal((await catalog())[0].id, manifest.id);
	assert.equal(requests, 2);
	assert.equal((await marketRequest(origin, path, cookie, 'DELETE')).status, 204);
	origin = (await restart()).services.get('http').origin;
	assert.deepEqual(await repositories(), []);
});

test('仓库目录按宿主分配的来源合并，刷新失败保留缓存，编辑和重启保留仓库身份', { timeout: 10000 }, async (t) => {
	const remote = await serveRepositories(t);
	const id = '@test/shared';
	const firstUrl = remote.publish('/a/catalog.json', [
		catalogEntry(id, remote.origin, [{}, { version: '2.0.0-beta.1' }]),
	]);
	const secondUrl = remote.publish('/b/catalog.json', [catalogEntry(id, remote.origin)]);
	const { app, restart, directory } = await setup(t);
	let origin = app.services.get('http').origin;
	assert.equal((await fetch(origin + catalogPath)).status, 401);
	assert.equal((await marketRequest(origin, repositoriesPath, '', 'POST', { url: firstUrl })).status, 401);
	assert.equal(remote.requests.length, 0);

	const cookie = await initializeOwner(origin);
	assert.equal((await marketRequest(origin, repositoriesPath, cookie, 'POST', { url: 'invalid-url' })).status, 400);
	const first = await addRepository(origin, cookie, firstUrl);
	const second = await addRepository(origin, cookie, secondUrl);
	assert.equal(first.official, false);
	assert.equal(second.official, false);
	assert.equal((await marketRequest(origin, repositoriesPath, cookie, 'POST', { url: firstUrl })).status, 409);

	const catalog = async (query = '') =>
		MarketplaceCatalogListSchema.parse(await (await marketRequest(origin, catalogPath + query, cookie)).json())
			.items;

	const [shared] = await catalog('?kind=extension&release=stable&keyword=' + encodeURIComponent('示例'));
	assert.equal(shared.id, id);
	assert.deepEqual(new Set(shared.versions.map(({ repositoryId }) => repositoryId)), new Set([first.id, second.id]));
	assert.deepEqual(
		(await catalog('?release=prerelease'))[0].versions.map(({ repositoryId }) => repositoryId),
		[first.id],
	);
	assert.deepEqual(await catalog('?kind=application'), []);
	assert.equal(remote.requests.length, 2);

	remote.publish('/a/catalog.json', [catalogEntry(id, remote.origin, [{}, {}])]);
	const refreshPath = `${repositoriesPath}/${first.id}/refresh`;
	const failed = await marketRequest(origin, refreshPath, cookie, 'POST');
	assert.equal(failed.status, 502);
	assert.equal((await failed.json()).code, 'MARKETPLACE_REPOSITORY_CATALOG_INVALID');
	assert.equal((await catalog())[0].versions.length, 3);

	const firstPath = `${repositoriesPath}/${first.id}`;
	let updated = await marketRequest(origin, firstPath, cookie, 'PATCH', { url: firstUrl, label: 'Local catalog' });
	assert.equal(updated.status, 200);
	assert.equal(MarketplaceRepositorySchema.parse(await updated.json()).label, 'Local catalog');
	assert.equal((await catalog())[0].versions.length, 3);

	const newUrl = remote.publish('/c/catalog.json', [catalogEntry('@test/catalog-replacement', remote.origin)]);
	updated = await marketRequest(origin, firstPath, cookie, 'PATCH', { url: newUrl, label: 'Local catalog' });
	assert.equal(MarketplaceRepositorySchema.parse(await updated.json()).id, first.id);
	assert.equal((await catalog())[0].versions.length, 1);
	assert.equal((await marketRequest(origin, refreshPath, cookie, 'POST')).status, 204);

	await recordInstalledPlugin(app, await writePlugin(directory, id));
	const recovered = await restart();
	origin = recovered.services.get('http').origin;
	const repositories = MarketplaceRepositoryListSchema.parse(
		await (await marketRequest(origin, repositoriesPath, cookie)).json(),
	);
	assert.equal(repositories.items.find(({ id }) => id === first.id)?.url, newUrl);
	assert.deepEqual(
		(await catalog()).map(({ id }) => id),
		['@test/catalog-replacement', id],
	);
	assert.equal((await marketRequest(origin, `${repositoriesPath}/${second.id}`, cookie, 'DELETE')).status, 204);
	assert.deepEqual(
		(await catalog()).map(({ id }) => id),
		['@test/catalog-replacement'],
	);
	assert.equal((await listInstalledPlugins(origin, cookie))[0].pluginId, id);
	assert.equal(remote.requests.length, 4);
	assert.ok(remote.requests.every(({ cookie, path }) => cookie === undefined && path.endsWith('/catalog.json')));
});

test('仓库和本地使用同一份清单校验与 Node 引擎约束', { timeout: 10000 }, async (t) => {
	const { app, directory } = await setup(t);
	const remote = await serveRepositories(t);
	const id = '@test/package-checks';
	const invalid = catalogEntry(id, remote.origin, [{ dependsOn: { [id]: '*' } }]);
	const url = remote.publish('/catalog.json', [invalid]);
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const rejected = await marketRequest(origin, repositoriesPath, cookie, 'POST', { url });
	assert.equal(rejected.status, 502);
	assert.equal((await rejected.json()).code, 'MARKETPLACE_REPOSITORY_CATALOG_INVALID');

	const local = await writePlugin(directory, id, { dependsOn: { [id]: '*' } });
	await assert.rejects(inspectPluginPackage(local), { code: 'PLUGIN_PACKAGE_INVALID' });

	const entry = catalogEntry(id, remote.origin);
	const [release] = entry.versions;
	const manifest = { ...release.package, engines: { node: '<1.0.0' } };
	remote.publish('/catalog.json', [{ ...entry, versions: [{ ...release, package: manifest }] }]);
	const repository = await addRepository(origin, cookie, url);
	const plan = await previewInstall(origin, cookie, repository.id, id);
	assert.deepEqual(plan.blockers, [{ code: 'PLUGIN_ARTIFACT_UNAVAILABLE', pluginId: id }]);

	await writeFile(join(local, 'package.json'), JSON.stringify(manifest));
	await assert.rejects(inspectPluginPackage(local), { code: 'PLUGIN_ENVIRONMENT_UNSUPPORTED' });
});

test('关闭宿主会取消未完成的仓库刷新，并保留上次成功的目录', { timeout: 10000 }, async (t) => {
	const remote = await serveRepositories(t);
	const path = '/catalog.json';
	const previous = '@test/previous';
	const url = remote.publish(path, [catalogEntry(previous, remote.origin)]);
	const { app, restart } = await setup(t);
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const { id } = await addRepository(origin, cookie, url);

	const started = Promise.withResolvers<void>();
	const disconnected = Promise.withResolvers<void>();
	remote.replies.set(path, (response) => {
		response.once('close', disconnected.resolve);
		response.writeHead(200, { 'Content-Type': 'application/json' }).write('[');
		started.resolve();
	});

	const refresh = marketRequest(origin, `${repositoriesPath}/${id}/refresh`, cookie, 'POST').catch(() => undefined);
	await started.promise;
	await Promise.all([app.close(), disconnected.promise, refresh]);

	const recovered = await restart();
	const response = await marketRequest(recovered.services.get('http').origin, catalogPath, cookie);
	const { items } = MarketplaceCatalogListSchema.parse(await response.json());
	assert.deepEqual(
		items.map(({ id }) => id),
		[previous],
	);
});

test('安装计划回溯共享版本、复用本地包，并固定仓库、版本和平台产物', { timeout: 10000 }, async (t) => {
	const remote = await serveRepositories(t);
	const root = '@test/root';
	const local = '@test/local';
	const dependency = '@test/dependency';
	const dependent = '@test/dependent';
	const companion = '@test/companion';
	const native = {
		tarball: remote.origin + '/native.tgz',
		integrity: 'sha512-selected',
		platform: { os: process.platform, arch: process.arch, abi: process.versions.modules },
	};
	const url = remote.publish('/catalog.json', [
		catalogEntry(root, remote.origin, [
			{ kind: 'application', dependsOn: { [dependency]: '*', [dependent]: '^1.0.0', [local]: '^1.0.0' } },
		]),
		catalogEntry(dependency, remote.origin, [
			{ version: '2.0.0' },
			{
				distributions: [{ tarball: remote.origin + '/generic.tgz' }, native],
			},
		]),
		catalogEntry(dependent, remote.origin, [{ dependsOn: { [dependency]: '^1.0.0' } }]),
		catalogEntry(companion, remote.origin, [{ requiredFor: [root], dependsOn: { [root]: '^1.0.0' } }]),
		catalogEntry(local, remote.origin),
	]);
	const { app, directory } = await setup(t);
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const repository = await addRepository(origin, cookie, url);
	const installed = await writePlugin(directory, local, { frontendOnly: true });
	await recordInstalledPlugin(app, installed);
	const plan = await previewInstall(origin, cookie, repository.id, root);
	assert.deepEqual(plan.blockers, []);
	const ids = plan.steps.map(({ package: manifest }) => manifest.name);
	assert.ok(ids.indexOf(dependent) < ids.indexOf(root));
	assert.ok(ids.indexOf(dependency) < ids.indexOf(dependent));
	assert.ok(ids.indexOf(root) < ids.indexOf(companion));
	const selected = plan.steps.find(({ package: manifest }) => manifest.name === dependency);
	assert.equal(selected?.package.version, '1.0.0');
	assert.deepEqual(selected?.source, {
		kind: 'repository',
		repositoryId: repository.id,
		pluginId: dependency,
		version: '1.0.0',
	});
	assert.deepEqual(selected?.distribution, native);
	const reused = plan.steps.find(({ package: manifest }) => manifest.name === local);
	assert.equal(reused?.action, 'reuse');
	assert.equal(reused?.previous?.version, '1.0.0');
	assert.match(reused?.previous?.revision ?? '', /^[a-f0-9]{64}$/u);
	assert.equal(JSON.stringify(plan).includes(installed), false);
	assert.equal((await listInstalledPlugins(origin, cookie)).length, 1);

	await rename(installed, join(directory, 'local.offline'));
	const blocked = await previewInstall(origin, cookie, repository.id, root);
	assert.deepEqual(blocked.steps, []);
	assert.ok(
		blocked.blockers.some(
			({ code, pluginId }) => code === 'MARKETPLACE_INSTALLED_PACKAGE_UNAVAILABLE' && pluginId === local,
		),
	);
	assert.deepEqual(
		remote.requests.map(({ path }) => path),
		['/catalog.json'],
	);
});

test('安装计划报告来源冲突、循环、SDK 和现有消费者的版本阻塞', { timeout: 10000 }, async (t) => {
	const remote = await serveRepositories(t);
	const shared = '@test/ambiguous';
	const root = '@test/root';
	const cycle = '@test/cycle';
	const sdk = '@test/sdk';
	const update = '@test/update';
	const mainUrl = remote.publish('/main/catalog.json', [
		catalogEntry(root, remote.origin, [{ dependsOn: { [shared]: '*' } }]),
		catalogEntry(cycle, remote.origin, [{ dependsOn: { '@test/cycle-child': '*' } }]),
		catalogEntry('@test/cycle-child', remote.origin, [{ dependsOn: { [cycle]: '*' } }]),
		catalogEntry(sdk, remote.origin, [{ sdk: '^99.0.0' }]),
		catalogEntry(update, remote.origin, [{ version: '2.0.0' }]),
	]);
	const firstUrl = remote.publish('/a/catalog.json', [catalogEntry(shared, remote.origin)]);
	const secondUrl = remote.publish('/b/catalog.json', [catalogEntry(shared, remote.origin)]);
	const officialUrl = remote.publish('/official/catalog.json', [catalogEntry(shared, remote.origin)]);
	const { app, directory } = await setup(t);
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const main = await addRepository(origin, cookie, mainUrl);
	const first = await addRepository(origin, cookie, firstUrl);
	const second = await addRepository(origin, cookie, secondUrl);

	const preview = (id: string, version?: string) => previewInstall(origin, cookie, main.id, id, version);

	assert.deepEqual((await preview(root)).blockers, [
		{
			code: 'PLUGIN_SOURCE_AMBIGUOUS',
			pluginId: shared,
			repositoryIds: [first.id, second.id].sort(),
		},
	]);
	const official = await addRepository(origin, cookie, officialUrl);
	const listed = await marketRequest(origin, catalogPath, cookie);
	const { items: catalog } = MarketplaceCatalogListSchema.parse(await listed.json());
	const planWithOfficial = planMarketplaceInstall({
		target: { kind: 'repository', repositoryId: main.id, pluginId: root, version: '1.0.0' },
		catalog,
		repositories: [main, first, second, { ...official, official: true }],
		installed: [],
	});
	assert.equal(planWithOfficial.steps[0].repository?.id, official.id);
	assert.equal((await preview(cycle)).blockers[0].code, 'PLUGIN_DEPENDENCY_CYCLE');
	assert.equal((await preview(sdk)).blockers[0].code, 'PLUGIN_SDK_INCOMPATIBLE');
	assert.equal((await preview(root, '9.0.0')).blockers[0].code, 'MARKETPLACE_PLUGIN_SOURCE_NOT_FOUND');

	await recordInstalledPlugin(app, await writePlugin(directory, update));
	await recordInstalledPlugin(
		app,
		await writePlugin(directory, '@test/consumer', { dependsOn: { [update]: '^1.0.0' } }),
	);
	assert.deepEqual((await preview(update, '2.0.0')).blockers, [
		{
			code: 'PLUGIN_DEPENDENCY_VERSION_MISMATCH',
			pluginId: update,
			required: '^1.0.0',
			actual: '2.0.0',
		},
	]);
});

test('从仓库安装并更新实际产物，卸载保留数据，确认清除后只删除该插件数据', { timeout: 25000 }, async (t) => {
	const { app, directory } = await setup(t);
	const repository = await serveRepositories(t);
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const completed = await observeOperations(t, origin, cookie);
	const pluginId = '@test/archive';
	const dependency = '@test/provider';
	const migrations = `
		import { PluginLogInputSchema } from 'nexus-terminal/node';
		export const backup = [{table: 'records', version: 1, keys: ['id'], fields: {id:'plain'}}];
		export const migrations = {async getMigrations() { return {initial: {async up(db) {
			await db.schema.createTable('records').addColumn('id', 'text', c => c.primaryKey()).execute();
		}}}; }};
		export async function activate(ctx) {
			await ctx.app.database.withClient(db => db.insertInto('records').values({id:'retained'}).onConflict(c => c.doNothing()).execute());
			ctx.app.log.report(PluginLogInputSchema.parse({level:'info', code:'TEST_MARKETPLACE_SDK'}));
			ctx.self.readiness.set({state:'ready'});
		}
	`;

	async function artifact(name: string, version: string, dependsOn?: Record<string, string>, source?: string) {
		const path = await writePlugin(join(directory, version), name, { version, dependsOn, source });
		const { package: manifest } = await inspectPluginPackage(path);
		const archivePath = join(directory, randomUUID() + '.tgz');
		await createArchive({ cwd: path, file: archivePath, gzip: true, prefix: 'package/' }, [
			'package.json',
			'index.mjs',
		]);
		const archive = await readFile(archivePath);
		const route = '/' + encodeURIComponent(name) + '-' + version + '.tgz';
		repository.replies.set(route, (response) => response.end(archive));
		return {
			package: manifest,
			distributions: [
				{
					tarball: repository.origin + route,
					integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
				},
			],
		};
	}

	const [provider, first, second] = await Promise.all([
		artifact(dependency, '1.0.0'),
		artifact(pluginId, '1.0.0', { [dependency]: '^1.0.0' }, migrations),
		artifact(pluginId, '2.0.0', { [dependency]: '^1.0.0' }, migrations),
	]);
	const source = await addRepository(
		origin,
		cookie,
		repository.publish('/install.json', [
			{ id: dependency, versions: [provider] },
			{ id: pluginId, versions: [first, second] },
		]),
	);

	async function run(path: string, input: object) {
		const response = await marketRequest(origin, managerPath + path, cookie, 'POST', input);
		assert.equal(response.status, 202, await response.clone().text());
		return completed(MarketplaceOperationSchema.parse(await response.json()).id);
	}

	const plan = await previewInstall(origin, cookie, source.id, pluginId);
	assert.deepEqual(
		plan.steps.map(({ package: manifest }) => manifest.name),
		[dependency, pluginId],
	);
	const outdated = structuredClone(plan);
	outdated.steps[0]!.distribution!.integrity = 'sha512-different';
	assert.equal((await run('/install', { plan: outdated })).error, 'MARKETPLACE_INSTALL_PLAN_CHANGED');
	assert.deepEqual(await listInstalledPlugins(origin, cookie), []);
	const installation = await run('/install', { plan });
	assert.equal(installation.state, 'succeeded');
	assert.deepEqual(installation.completedPackages, [dependency, pluginId]);
	assert.equal(
		(await listInstalledPlugins(origin, cookie)).find((row) => row.pluginId === pluginId)?.runtime?.runtime,
		'running',
	);

	const dependant = await marketRequest(
		origin,
		managerPath + '/plugins/' + encodeURIComponent(dependency) + '/uninstall-plan',
		cookie,
	);
	assert.deepEqual(MarketplaceUninstallPlanSchema.parse(await dependant.json()).dependents, [pluginId]);
	const impactResponse = await marketRequest(
		origin,
		managerPath + '/plugins/' + encodeURIComponent(dependency) + '/runtime-impact',
		cookie,
	);
	assert.equal(impactResponse.status, 200);
	const impact = MarketplaceRuntimeImpactSchema.parse(await impactResponse.json());
	assert.deepEqual(impact.dependents, [pluginId]);
	assert.equal(impact.pluginId, dependency);
	assert.equal(impact.version, '1.0.0');
	const badRevision = impact.revision === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
	const rejected = await setEnabled(origin, dependency, cookie, { enabled: false, impactRevision: badRevision });
	const rejectedOperation = await completed(MarketplaceOperationSchema.parse(await rejected.json()).id);
	assert.equal(rejectedOperation.error, 'MARKETPLACE_INSTALL_PLAN_CHANGED');
	assert.equal(rejectedOperation.committed, false);
	const rejectedReload = await run('/reload', { pluginId: dependency, impactRevision: badRevision });
	assert.equal(rejectedReload.error, 'MARKETPLACE_INSTALL_PLAN_CHANGED');
	assert.equal(rejectedReload.committed, false);
	assert.equal(
		(await listInstalledPlugins(origin, cookie)).find((row) => row.pluginId === dependency)?.enabled,
		true,
	);
	const confirmedReload = await run('/reload', { pluginId: dependency, impactRevision: impact.revision });
	assert.equal(confirmedReload.state, 'succeeded');

	const disabled = await setEnabled(origin, pluginId, cookie, { enabled: false });
	assert.equal((await completed(MarketplaceOperationSchema.parse(await disabled.json()).id)).state, 'succeeded');
	const update = await previewInstall(origin, cookie, source.id, pluginId, '2.0.0');
	assert.equal((await run('/install', { plan: update })).state, 'succeeded');
	const installed = (await listInstalledPlugins(origin, cookie)).find((item) => item.pluginId === pluginId);
	assert.deepEqual(installed?.source, { kind: 'repository', repositoryId: source.id, pluginId, version: '2.0.0' });
	assert.equal(installed?.enabled, false);

	const response = await marketRequest(
		origin,
		managerPath + '/plugins/' + encodeURIComponent(pluginId) + '/uninstall-plan',
		cookie,
	);
	const uninstall = MarketplaceUninstallPlanSchema.parse(await response.json());
	assert.equal(
		(await run('/uninstall', { pluginId, revision: uninstall.revision, data: 'keep' })).state,
		'succeeded',
	);
	// Uninstall changed the actual dependency graph since the preview, not just the supplied hash.
	const stale = await setEnabled(origin, dependency, cookie, { enabled: false, impactRevision: impact.revision });
	const staleOperation = await completed(MarketplaceOperationSchema.parse(await stale.json()).id);
	assert.equal(staleOperation.error, 'MARKETPLACE_INSTALL_PLAN_CHANGED');
	assert.equal(staleOperation.committed, false);
	const retained = await marketRequest(origin, managerPath + '/retained-data', cookie);
	assert.deepEqual(MarketplaceRetainedDataListSchema.parse(await retained.json()).items, [
		{ pluginId, version: '2.0.0' },
	]);
	const table = pluginTablePrefix(pluginId) + 'records';
	const database = app.services.get('database');
	assert.equal((await database.withClient((db) => sql`select id from ${sql.id(table)}`.execute(db))).rows.length, 1);

	assert.equal((await run('/clear-data', { pluginId })).state, 'succeeded');
	const after = await marketRequest(origin, managerPath + '/retained-data', cookie);
	assert.deepEqual(MarketplaceRetainedDataListSchema.parse(await after.json()).items, []);
	const cleared = await database.withClient((db) =>
		sql`select name from sqlite_schema where name = ${table}`.execute(db),
	);
	assert.deepEqual(cleared.rows, []);
	assert.equal(
		(await listInstalledPlugins(origin, cookie)).find((row) => row.pluginId === dependency)?.runtime?.runtime,
		'running',
	);
});

test('宿主重启保留中断安装并回收未登记产物，不重放下载', async (t) => {
	const fixture = await setup(t);
	const { app, directory } = fixture;
	const origin = app.services.get('http').origin;
	const cookie = await initializeOwner(origin);
	const scope = new PluginScope(() => {});
	const storage = new MarketplaceStorage(app.services.get('database').bind(MarketplacePluginId, scope));
	const target = {
		kind: 'repository',
		pluginId: '@test/interrupted',
		repositoryId: randomUUID(),
		version: '1.0.0',
	} as const;
	try {
		await storage.startAttempt(target);
	} finally {
		await scope.close();
	}
	const root = join(directory, 'data', 'plugin-packages');
	const staging = join(root, '.staging-' + randomUUID());
	const unrelated = join(root, 'unrelated');
	await mkdir(staging);
	await mkdir(unrelated);
	const restarted = await fixture.restart();
	const nextOrigin = restarted.services.get('http').origin;
	const path = managerPath + '/install-attempts';
	const response = await marketRequest(nextOrigin, path, cookie);
	assert.deepEqual(MarketplaceInstallAttemptsSchema.parse(await response.json()).items, [
		{ target, state: 'interrupted' },
	]);
	assert.deepEqual(await readdir(root), ['unrelated']);
	assert.equal(
		(await marketRequest(nextOrigin, path + '/' + encodeURIComponent(target.pluginId), cookie, 'DELETE')).status,
		204,
	);
	const after = await marketRequest(nextOrigin, path, cookie);
	assert.deepEqual(MarketplaceInstallAttemptsSchema.parse(await after.json()).items, []);
});
