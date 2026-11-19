import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { App } from '../../../src/app/node/app.js';
import { backupBase } from '../../../src/backup/backup-http-types.js';
import { MarketplacePluginId } from '../../../src/marketplace/marketplace-types.js';
import { settingsBase } from '../../../src/settings/settings-http-types.js';

test('宿主服务、内置插件和外部插件按阶段开放路由', async (t) => {
	const resources = new AsyncDisposableStack();

	t.after(() => resources.disposeAsync());

	const dataDirectory = await mkdtemp(join(tmpdir(), 'nexus-app-'));
	resources.defer(() => rm(dataDirectory, { recursive: true, force: true }));
	const app = new App({ dataDirectory, logLevel: 'fatal' });
	resources.defer(() => app.close());
	assert.throws(() => app.services.get('http'), { code: 'SERVICE_NOT_READY' });
	await assert.rejects(app.startBuiltinPlugins(), { code: 'SERVICE_NOT_READY' });
	await assert.rejects(app.startExternalPlugins(), { code: 'SERVICE_NOT_READY' });

	const starting = app.initialize();
	assert.equal(app.initialize(), starting);
	await starting;

	const origin = app.services.get('http').origin;
	const auth = await fetch(origin + '/api/auth/initialize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'fixture', password: 'fixture-owner' }),
	});
	assert.equal(auth.status, 201);
	const sessionCookie = auth.headers.get('set-cookie')?.split(';')[0];
	assert.ok(sessionCookie);
	const cookie = sessionCookie;
	await auth.body?.cancel();

	async function status(path: string): Promise<number> {
		const response = await fetch(origin + path, { headers: { cookie } });
		await response.body?.cancel();
		return response.status;
	}

	const marketplace = '/api/plugins/' + encodeURIComponent(MarketplacePluginId) + '/plugins';
	const builtins = [marketplace, settingsBase, backupBase + '/status'];
	for (const route of builtins) assert.equal(await status(route), 404, route);

	await Promise.all([app.startBuiltinPlugins(), app.startBuiltinPlugins()]);
	for (const route of builtins) assert.equal(await status(route), 200, route);

	const external = '/api/plugins/%40nexus-terminal%2Ftest/items';
	assert.equal(await status(external), 404);
	await app.startExternalPlugins([fileURLToPath(new URL('../../fixtures/plugins/test/', import.meta.url))]);
	assert.equal(await status(external), 200);

	const closing = app.close();
	assert.equal(app.close(), closing);
	await closing;
	await assert.rejects(fetch(origin + '/api/auth/state'));
});

test('监听失败保留原始错误并释放已初始化资源，同目录可以重新启动', async (t) => {
	const resources = new AsyncDisposableStack();

	t.after(() => resources.disposeAsync());

	const dataDirectory = await mkdtemp(join(tmpdir(), 'nexus-app-port-'));
	resources.defer(() => rm(dataDirectory, { recursive: true, force: true }));
	const server = createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	resources.defer(() => {
		if (server.listening)
			return new Promise<void>((resolve, reject) => server.close((cause) => (cause ? reject(cause) : resolve())));
	});
	const address = server.address();
	assert.ok(address && typeof address !== 'string');

	const options = { dataDirectory, httpPort: address.port, logLevel: 'fatal' } as const;
	const failed = new App(options);
	resources.defer(() => failed.close());
	let original: unknown;
	await assert.rejects(failed.initialize(), (cause: NodeJS.ErrnoException) => {
		original = cause;
		return cause.code === 'EADDRINUSE';
	});
	assert.throws(
		() => failed.initialize(),
		(cause) => cause === original,
	);
	assert.throws(() => failed.services.get('database'), { code: 'SERVICE_CLOSED' });

	const closed = once(server, 'close');
	server.close();
	await closed;

	const restarted = new App(options);
	resources.defer(() => restarted.close());
	await restarted.initialize();
	const response = await fetch(restarted.services.get('http').origin + '/api/auth/state');
	assert.equal(response.status, 200);
	assert.equal((await response.json()).initialized, false);
});
