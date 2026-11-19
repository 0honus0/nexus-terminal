import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { App } from '../../../src/app/node/app.js';
import { PluginTestHost } from './plugin-test-host.js';
import { HttpApi } from '../../../src/http/node/http-api.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';
import { WsApi } from '../../../src/ws/node/ws-api.js';

function upgradeStatus(url: string, options: { cookie?: string; origin?: string } = {}): Promise<number | undefined> {
	return new Promise((resolve, reject) => {
		const client = new WebSocket(url, {
			handshakeTimeout: 2000,
			headers: options.cookie ? { cookie: options.cookie } : undefined,
			origin: options.origin,
		});
		client.once('error', reject);
		client.once('unexpected-response', (_request, response) => {
			response.resume();
			resolve(response.statusCode);
			client.close();
		});
		client.once('open', () => {
			client.terminate();
			reject(new Error('Expected an HTTP rejection'));
		});
	});
}

async function post(origin: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (cookie) headers.cookie = cookie;
	return fetch(`${origin}/api/auth/${path}`, {
		method: 'POST',
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function login(response: Response, status: number): Promise<string> {
	assert.equal(response.status, status);
	await response.arrayBuffer();
	const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
	assert.ok(cookie);
	return cookie;
}

async function open(url: string, cookie: string): Promise<WebSocket> {
	const client = new WebSocket(url, { handshakeTimeout: 2000, headers: { cookie } });
	await once(client, 'open');
	return client;
}

test('插件 WS 和 HTTP 共用端口，登录后双向传输，停用撤销路径，重载后恢复', { timeout: 10000 }, async () => {
	const dataDirectory = await mkdtemp(join(tmpdir(), 'nexus-plugin-ws-'));
	const host = new PluginTestHost({ dataDirectory, logLevel: 'fatal' });
	const directory = fileURLToPath(new URL('../../fixtures/plugins/test/', import.meta.url));
	try {
		await host.initialize();
		await host.runtime.start([directory]);
		const runtime = host.runtime;
		const origin = host.services.get('http').origin;
		const prefix = origin.replace('http:', 'ws:') + '/api/plugins/%40nexus-terminal%2Ftest';
		const url = prefix + '/echo';
		assert.equal(await upgradeStatus(prefix + '/unknown'), 404);
		assert.equal(await upgradeStatus(url), 401);
		assert.equal(await upgradeStatus(url, { origin: 'https://example.com' }), 403);
		const cookie = await login(
			await post(origin, 'initialize', { username: 'test', password: 'test-password' }),
			201,
		);
		const client = await open(url, cookie);
		const text = once(client, 'message');
		client.send(JSON.stringify({ type: 'ping' }));
		const [data, binary] = await text;
		assert.equal(binary, false);
		assert.deepEqual(JSON.parse(data.toString()), { type: 'ping' });

		const message = once(client, 'message');
		client.send(Buffer.from([0, 255]));
		const [bytes, isBinary] = await message;
		assert.equal(isBinary, true);
		assert.deepEqual(bytes, Buffer.from([0, 255]));

		const large = await open(url, cookie);
		const tooLarge = once(large, 'close');
		large.send(Buffer.alloc(1025));
		assert.equal((await tooLarge)[0], 1009);

		const closed = once(client, 'close');
		await runtime.stop('@nexus-terminal/test');
		await closed;
		assert.equal(await upgradeStatus(url, { cookie }), 404);
		await runtime.reload('@nexus-terminal/test');
		const reloaded = await open(url, cookie);
		const appClosed = once(reloaded, 'close');
		await host.close();
		await appClosed;
	} finally {
		try {
			await host.close();
		} finally {
			await rm(dataDirectory, { recursive: true, force: true });
		}
	}
});

test('注销只撤销当前会话的 WS，改密关闭其他旧会话的连接', { timeout: 10000 }, async () => {
	const dataDirectory = await mkdtemp(join(tmpdir(), 'nexus-ws-auth-'));
	const app = new App({ dataDirectory, logLevel: 'fatal' });
	try {
		await app.initialize();
		const origin = app.services.get('http').origin;
		const url = origin.replace('http:', 'ws:') + '/api/session';
		app.services.get('ws').register({
			path: '/session',

			handler(socket) {
				socket.on('message', (data, binary) => socket.send(data, { binary }));
			},
		});
		const credentials = { username: 'test', password: 'test-password' };
		const first = await login(await post(origin, 'initialize', credentials), 201);
		const second = await login(await post(origin, 'login', credentials), 200);
		const a = await open(url, first);
		const b = await open(url, second);
		const logout = once(a, 'close');
		assert.equal((await post(origin, 'logout', undefined, first)).status, 204);
		assert.equal((await logout)[0], 4001);
		assert.equal(b.readyState, WebSocket.OPEN);
		assert.equal(await upgradeStatus(url, { cookie: first }), 401);
		const c = await open(url, second);
		const changed = Promise.all([once(b, 'close'), once(c, 'close')]);
		const current = await login(
			await post(origin, 'password', { currentPassword: credentials.password, newPassword: 'updated' }, second),
			204,
		);
		assert.deepEqual(
			(await changed).map(([code]) => code),
			[4001, 4001],
		);
		assert.equal(await upgradeStatus(url, { cookie: second }), 401);
		const fresh = await open(url, current);
		const echoed = once(fresh, 'message');
		fresh.send('ok');
		assert.equal((await echoed)[0].toString(), 'ok');
	} finally {
		try {
			await app.close();
		} finally {
			await rm(dataDirectory, { recursive: true, force: true });
		}
	}
});

test('依赖作用域撤销时拒绝未完成的握手，等待迟到的会话许可清理', { timeout: 5000 }, async () => {
	const owner = new PluginScope(() => {});
	const child = new PluginScope(() => {});
	const log = { report() {} };
	const http = new HttpApi({
		port: 0,
		services: { log, auth: { authenticate: async () => false } },
	});
	const checking = Promise.withResolvers<AbortSignal>();
	const release = Promise.withResolvers<void>();
	let disposed = false;
	let connected = false;
	const ws = new WsApi({
		services: {
			http,
			log,
			auth: {
				async authorizeUpgrade(_request, signal) {
					checking.resolve(signal);
					await release.promise;
					return {
						signal,

						validate: async () => true,

						dispose() {
							disposed = true;
						},
					};
				},
			},
		},
	});
	try {
		await http.initialize(owner.signal);
		ws.initialize(owner.signal);
		ws.bind('test', owner).register({
			path: '/child',
			lifetime: child,

			handler() {
				connected = true;
			},
		});
		const url = http.origin.replace('http:', 'ws:') + '/api/plugins/test/child';
		const handshake = upgradeStatus(url);
		const signal = await checking.promise;
		let closed = false;
		const closing = child.close().then(() => {
			closed = true;
		});
		assert.equal(signal.aborted, true);
		assert.equal(await handshake, 503);
		assert.equal(await upgradeStatus(url), 404);
		assert.equal(closed, false);
		release.resolve();
		await closing;
		assert.equal(disposed, true);
		assert.equal(connected, false);
	} finally {
		release.resolve();
		await child.close();
		await owner.close();
		await ws.close();
		await http.close();
	}
});
