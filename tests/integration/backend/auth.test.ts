import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { App } from '../../../src/app/node/app.js';
import { PluginTestHost } from './plugin-test-host.js';
import { AuthStateSchema } from '../../../src/auth/auth-http-types.js';

function auth(origin: string, path: string, options: { cookie?: string; body?: unknown; method?: string } = {}) {
	const headers: Record<string, string> = {};
	if (options.cookie) headers.cookie = options.cookie;
	if (options.body !== undefined) headers['content-type'] = 'application/json';
	return fetch(`${origin}/api/auth/${path}`, {
		method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
}

function sessionCookie(response: Response): string {
	const header = response.headers.get('set-cookie');
	assert.ok(header);
	assert.match(header, /; HttpOnly/u);
	assert.match(header, /; SameSite=Strict/u);
	return header.split(';', 1)[0];
}

test('单 owner 会话重启后可用，改密撤销旧会话，退出撤销当前会话', { timeout: 15000 }, async () => {
	const dataDirectory = await mkdtemp(join(tmpdir(), 'nexus-auth-'));
	const options = { dataDirectory, logLevel: 'fatal' } as const;
	let app = new App(options);
	try {
		await app.initialize();
		let origin = app.services.get('http').origin;
		const credentials = { username: 'test', password: 'initial password' };
		const methods = [{ pluginId: null, id: 'password', label: 'auth.password', baseURL: '/api/auth/' }];
		assert.deepEqual(await (await auth(origin, 'state')).json(), { initialized: false, account: null, methods });

		const initialized = await auth(origin, 'initialize', { body: credentials });
		assert.equal(initialized.status, 201);
		assert.deepEqual(await initialized.json(), { id: 'owner', username: 'test' });
		const old = sessionCookie(initialized);
		const duplicate = await auth(origin, 'initialize', { body: credentials });
		assert.equal(duplicate.status, 409);
		assert.equal((await duplicate.json()).code, 'AUTH_ALREADY_INITIALIZED');
		await app.close();

		app = new App(options);
		await app.initialize();
		origin = app.services.get('http').origin;
		assert.deepEqual(await (await auth(origin, 'state', { cookie: old })).json(), {
			initialized: true,
			account: { id: 'owner', username: 'test' },
			methods,
		});
		const login = await auth(origin, 'login', { body: credentials });
		assert.equal(login.status, 200);
		await login.arrayBuffer();
		const other = sessionCookie(login);
		assert.notEqual(old, other);
		const changed = await auth(origin, 'password', {
			cookie: old,
			body: { currentPassword: credentials.password, newPassword: 'new password' },
		});
		assert.equal(changed.status, 204);
		const current = sessionCookie(changed);
		for (const cookie of [old, other]) {
			assert.equal((await (await auth(origin, 'state', { cookie })).json()).account, null);
		}
		const failed = await auth(origin, 'login', { body: credentials });
		assert.equal(failed.status, 401);
		assert.equal((await failed.json()).code, 'AUTH_INVALID_CREDENTIALS');
		assert.equal((await (await auth(origin, 'state', { cookie: current })).json()).account.id, 'owner');
		assert.equal((await auth(origin, 'logout', { method: 'POST', cookie: current })).status, 204);
		assert.equal((await (await auth(origin, 'state', { cookie: current })).json()).account, null);
	} finally {
		try {
			await app.close();
		} finally {
			await rm(dataDirectory, { recursive: true, force: true });
		}
	}
});

test('登录扩展按实例和就绪状态登记，登录沿用宿主会话', { timeout: 15000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-auth-method-'));
	const host = new PluginTestHost({ dataDirectory: join(directory, 'data'), logLevel: 'fatal' });
	const pluginId = '@test/auth-method';
	const plugin = join(directory, 'plugin');
	const hooksURL = pathToFileURL(join(plugin, 'hooks.mjs')).href;
	const sdkURL = new URL('../../../src/sdk/node/index.ts', import.meta.url).href;
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();

	t.after(async () => {
		resume.resolve();
		try {
			await host.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	await mkdir(plugin);
	await Promise.all([
		writeFile(
			join(plugin, 'package.json'),
			JSON.stringify({
				name: pluginId,
				version: '1.0.0',
				type: 'module',
				peerDependencies: { 'nexus-terminal': '^1.0.0' },
				nexus: { kind: 'extension', entry: { backend: 'index.mjs' }, authMethods: true },
			}),
		),
		writeFile(join(plugin, 'hooks.mjs'), 'export const hooks = {};'),
		writeFile(
			join(plugin, 'index.mjs'),
			`import { z } from ${JSON.stringify(import.meta.resolve('zod'))};
			import { HttpFailure } from ${JSON.stringify(sdkURL)};
			import { hooks } from ${JSON.stringify(hooksURL)};

			export function activate({ authMethods, self }) {
				const empty = z.strictObject({});
				const proof = z.strictObject({ proof: z.string() });
				const registration = authMethods.register({
					id: 'example',
					label: 'auth.example',
					routes: [
						{
							method: 'post',
							path: '/verify',
							input: proof,
							output: empty,
							status: 201,
							async handler({ proof }, _signal, { completeLogin }) {
								if (proof !== 'valid' && proof !== 'pause')
									throw new HttpFailure(401, 'AUTH_INVALID_CREDENTIALS');
								await completeLogin();
								if (proof === 'pause') await hooks.pauseAfterLogin();
								return {};
							},
						},
						{
							method: 'get',
							path: '/callback',
							callback: true,
							input: proof,
							output: empty,
							status: 201,
							async handler({ proof }, _signal, context) {
								if (proof !== 'valid') throw new HttpFailure(401, 'AUTH_INVALID_CREDENTIALS');
								await context.completeLogin();
								context.redirect('/');
								return {};
							},
						},
					],
				});
				hooks.registration = registration;
				hooks.setReady = (ready) => self.readiness.set(ready
					? { state: 'ready' }
					: { state: 'pending', reason: { code: 'PLUGIN_CONFIGURATION_REQUIRED' } });
			}`,
		),
	]);

	const { hooks } = (await import(hooksURL)) as {
		hooks: {
			registration: { baseURL: string; dispose(): Promise<void> };
			setReady(ready: boolean): void;
			pauseAfterLogin(): Promise<void>;
		};
	};
	hooks.pauseAfterLogin = async () => {
		entered.resolve();
		await resume.promise;
	};

	await host.initialize();
	await host.runtime.start([plugin]);
	const origin = host.services.get('http').origin;
	const { baseURL } = hooks.registration;

	async function readState(cookie?: string) {
		return AuthStateSchema.parse(await (await auth(origin, 'state', { cookie })).json());
	}

	function verify(proof: string) {
		return fetch(`${origin}${baseURL}verify`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ proof }),
		});
	}

	assert.deepEqual(
		(await readState()).methods.map(({ id }) => id),
		['password'],
	);
	assert.equal((await verify('valid')).status, 503);
	hooks.setReady(true);
	assert.deepEqual((await readState()).methods[1], { pluginId, id: 'example', label: 'auth.example', baseURL });
	assert.equal((await verify('valid')).status, 409);

	const initialized = await auth(origin, 'initialize', { body: { username: 'test', password: 'test password' } });
	assert.equal(initialized.status, 201);
	await initialized.arrayBuffer();
	assert.equal((await verify('invalid')).status, 401);
	const verified = await verify('valid');
	assert.equal(verified.status, 201);
	assert.deepEqual((await readState(sessionCookie(verified))).account, { id: 'owner', username: 'test' });

	const callbackURL = `${origin}${baseURL}callback?proof=valid`;
	assert.equal((await fetch(callbackURL, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
	// Fetch 会自行设置 Sec-Fetch-Mode。用原生 HTTP 模拟浏览器顶层导航。
	const callback = await new Promise<IncomingMessage>((resolve, reject) => {
		get(callbackURL, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } }, resolve).on(
			'error',
			reject,
		);
	});
	callback.resume();
	assert.equal(callback.statusCode, 303);
	assert.equal(callback.headers.location, '/');
	const callbackCookie = callback.headers['set-cookie']?.[0]?.split(';', 1)[0];
	assert.ok(callbackCookie);
	assert.equal((await readState(callbackCookie)).account?.id, 'owner');

	const database = host.services.get('database');

	function sessionCount() {
		return database.withClient((db) =>
			db
				.$extendTables<{ nexus_http_session: { id: string } }>()
				.selectFrom('nexus_http_session')
				.select('id')
				.execute()
				.then((rows) => rows.length),
		);
	}

	const before = await sessionCount();
	const inFlight = verify('pause');
	try {
		await Promise.race([
			entered.promise,
			inFlight.then((response) => assert.fail(`登录提前结束，状态 ${response.status}`)),
		]);
		assert.equal(await sessionCount(), before + 1);
		hooks.setReady(false);
		assert.deepEqual(
			(await readState()).methods.map(({ id }) => id),
			['password'],
		);
		hooks.setReady(true);
	} finally {
		resume.resolve();
	}
	const expired = await inFlight;
	assert.equal(expired.status, 503);
	assert.equal((await expired.json()).code, 'AUTH_METHOD_UNAVAILABLE');
	assert.equal(expired.headers.get('set-cookie'), null);
	assert.equal(await sessionCount(), before);

	const runtime = host.runtime;
	const original = hooks.registration;
	await runtime.stop(pluginId);
	assert.deepEqual(
		(await readState()).methods.map(({ id }) => id),
		['password'],
	);
	assert.equal((await verify('valid')).status, 404);
	await runtime.reload(pluginId);
	hooks.setReady(true);
	await original.dispose();
	assert.equal((await readState()).methods[1]?.pluginId, pluginId);
	await hooks.registration.dispose();
	assert.equal((await verify('valid')).status, 404);
	assert.equal((await readState(sessionCookie(verified))).account?.id, 'owner');
});
