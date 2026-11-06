import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { openHttpListener } from '../../../packages/backend/dist/platform/http/http-server.js';
import { readRequestCookie } from '../../../packages/backend/dist/platform/http/http-request.js';
import { observeOperationRoutes } from '../../../packages/backend/dist/modules/operations/interfaces/http/operation-observer.js';
import { AuditEventOwner } from '../../../packages/backend/dist/modules/operations/audit/service/audit-event-owner.js';
import { readMultipart } from '../../../packages/backend/dist/platform/http/http-body.js';

const origin = 'http://127.0.0.1:0';

function deferred() {
	const { promise, resolve, reject } = Promise.withResolvers();
	return { promise, resolve, reject };
}

function send(server, method, path, body, headers = {}) {
	return new Promise((resolve, reject) => {
		const req = request(
			'http://' + server.address + path,
			{
				method,
				headers: {
					Host: new URL(origin).host,
					Origin: origin,
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...headers,
				},
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () => {
					const bytes = Buffer.concat(chunks);
					resolve({
						status: response.statusCode,
						headers: response.headers,
						bytes,

						json: () => JSON.parse(bytes.toString()),
					});
				});
			},
		);
		req.on('error', reject);
		req.setTimeout(5000, () => req.destroy(new Error('HTTP test deadline')));
		req.end(body);
	});
}

function listen(routes) {
	return openHttpListener({ bindHost: '127.0.0.1', port: 0, publicOrigin: origin, trustedProxies: [], routes });
}

test('native multipart scope preserves separate JSON budgets and admission before parsing', async () => {
	const bytes = Buffer.alloc(96 * 1024, 97);
	const body = Buffer.concat([
		Buffer.from('--scope\r\nContent-Disposition: form-data; name="file"; filename="data.txt"\r\n\r\n'),
		bytes,
		Buffer.from('\r\n--scope--\r\n'),
	]);
	const server = await listen([
		{
			method: 'POST',
			url: '/mixed',
			bodyLimit: 16,
			config: { multipartBodyLimit: body.length },

			async onRequest(request, reply) {
				if (request.headers['x-test-admitted'] !== 'yes') {
					return reply.code(401).send({ code: 'unauthenticated' });
				}
			},

			async handler(request, reply) {
				if (!request.isMultipart()) {
					return reply.send(request.body);
				}
				const parts = await readMultipart(
					request,
					reply,
					{ maxParts: 1, maxFileBytes: bytes.length, maxFieldBytes: 16 },
					new AbortController().signal,
				);
				try {
					assert.deepEqual(parts[0].bytes, bytes);
					return reply.send({ size: parts[0].bytes.length });
				} finally {
					parts[0].bytes.fill(0);
				}
			},
		},
		{
			method: 'POST',
			url: '/json-only',

			async handler(request, reply) {
				return reply.send(request.body);
			},
		},
	]);
	try {
		const headers = { 'Content-Type': 'multipart/form-data; boundary=scope', 'x-test-admitted': 'yes' };
		const uploaded = await send(server, 'POST', '/mixed', body, headers);
		assert.equal(uploaded.status, 200);
		assert.deepEqual(uploaded.json(), { size: bytes.length });
		assert.equal((await send(server, 'POST', '/json-only', body, headers)).status, 415);
		assert.equal((await send(server, 'POST', '/mixed', '{}', { 'x-test-admitted': 'yes' })).status, 200);
		assert.equal(
			(
				await send(server, 'POST', '/mixed', JSON.stringify({ value: 'x'.repeat(20) }), {
					'x-test-admitted': 'yes',
				})
			).status,
			413,
		);
		assert.equal(
			(await send(server, 'POST', '/mixed', Buffer.concat([body, Buffer.from('x')]), headers)).status,
			413,
		);
		assert.equal(
			(
				await send(server, 'POST', '/mixed', Buffer.concat([body, Buffer.from('x')]), {
					...headers,
					'x-test-admitted': 'no',
				})
			).status,
			401,
		);
	} finally {
		await server.close();
	}
});

test(
	'Fastify preserves strict JSON, duplicate query/cookie facts and explicit body budgets',
	{ timeout: 10000 },
	async () => {
		const server = await listen([
			{
				method: 'POST',
				url: '/echo/:id',
				bodyLimit: 20000,

				async handler(req, reply) {
					reply.send({
						body: req.body,
						id: req.params.id,
						query: req.query.getAll('q'),
						cookie: readRequestCookie(req.raw, 'session'),
					});
				},
			},
			{
				method: 'POST',
				url: '/small',
				bodyLimit: 8,

				async handler(req, reply) {
					reply.send(req.body);
				},
			},
		]);
		try {
			const valid = await send(
				server,
				'POST',
				'/echo/a%3Ab?q=1&q=2',
				JSON.stringify({ value: 'x'.repeat(17000) }),
				{ Cookie: 'session=a; session=b' },
			);
			assert.equal(valid.status, 200);
			assert.deepEqual(valid.json(), {
				body: { value: 'x'.repeat(17000) },
				id: 'a:b',
				query: ['1', '2'],
				cookie: null,
			});
			for (const body of [
				'{',
				Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
				'{"__proto__":{}}',
			]) {
				const invalid = await send(server, 'POST', '/echo/a', body);
				assert.equal(invalid.status, 400);
				assert.deepEqual(invalid.json(), { code: 'invalid_json' });
			}
			const big = await send(server, 'POST', '/small', '{"a":123}');
			assert.equal(big.status, 413);
			assert.deepEqual(big.json(), { code: 'body_too_large' });
			assert.equal((await send(server, 'POST', '/echo/a', '{}', { 'Content-Type': 'text/plain' })).status, 415);
			assert.equal((await send(server, 'POST', '/echo/a', '{}', { Origin: 'http://evil.invalid' })).status, 403);
			assert.equal((await send(server, 'POST', '/echo/a', '{}', { Host: 'evil.invalid' })).status, 403);
		} finally {
			await server.close();
		}
	},
);

test(
	'Fastify early rejection with asynchronous onSend never enters the route handler',
	{ timeout: 10000 },
	async () => {
		let entered = false;
		const server = await listen([
			{
				method: 'POST',
				url: '/denied',

				async onRequest(_req, reply) {
					return reply.code(403).send({ code: 'forbidden' });
				},

				async onSend(_req, _reply, payload) {
					await nextTurn();
					return payload;
				},

				async handler(_req, reply) {
					entered = true;
					reply.send({ unexpected: true });
				},
			},
		]);
		try {
			const response = await send(server, 'POST', '/denied', 'invalid json');
			assert.equal(response.status, 403);
			assert.deepEqual(response.json(), { code: 'forbidden' });
			assert.equal(entered, false);
		} finally {
			await server.close();
		}
	},
);

test(
	'Fastify raw ingress and explicit HEAD stream delivery do not double consume or auto register',
	{ timeout: 10000 },
	async () => {
		const server = await listen([
			{
				method: 'POST',
				url: '/raw',
				config: { rawBody: true },

				async handler(req, reply) {
					const chunks = [];
					for await (const chunk of req.raw) {
						chunks.push(chunk);
					}
					const bytes = Buffer.concat(chunks);
					reply.hijack();
					reply.raw.writeHead(200, {
						'Content-Type': 'application/octet-stream',
						'Content-Length': bytes.length,
					});
					reply.raw.end(bytes);
				},
			},
			{
				method: 'GET',
				url: '/file',

				async handler(_req, reply) {
					reply.send('content');
				},
			},
			{
				method: 'HEAD',
				url: '/file',

				async handler(_req, reply) {
					reply.header('X-Explicit-Head', 'yes').send();
				},
			},
		]);
		try {
			const raw = await send(server, 'POST', '/raw', 'not json', { 'Content-Type': 'application/json' });
			assert.equal(raw.status, 200);
			assert.equal(raw.bytes.toString(), 'not json');
			const head = await send(server, 'HEAD', '/file');
			assert.equal(head.status, 200);
			assert.equal(head.headers['x-explicit-head'], 'yes');
			assert.equal(head.bytes.length, 0);
		} finally {
			await server.close();
		}
	},
);

test(
	'maintenance waits for handler work after reply completion before publishing replacement routes',
	{ timeout: 10000 },
	async () => {
		const release = deferred();
		const entered = deferred();
		const server = await listen([
			{
				method: 'GET',
				url: '/work',

				async handler(_req, reply) {
					reply.send({ generation: 1 });
					entered.resolve();
					await release.promise;
				},
			},
		]);
		try {
			const response = await send(server, 'GET', '/work');
			assert.equal(response.json().generation, 1);
			await entered.promise;
			const lease = server.suspend();
			let drained = false;
			const drain = lease.drain().then(() => {
				drained = true;
			});
			await nextTurn();
			assert.equal(drained, false);
			assert.equal((await send(server, 'GET', '/work')).status, 503);
			release.resolve();
			await drain;
			await lease.replace({
				routes: [
					{
						method: 'GET',
						url: '/work',

						async handler(_req, reply) {
							reply.send({ generation: 2 });
						},
					},
				],
			});
			lease.resume();
			assert.equal((await send(server, 'GET', '/work')).json().generation, 2);
		} finally {
			release.resolve();
			await server.close();
		}
	},
);

test('maintenance waits for late admission hook and never starts an aborted handler', { timeout: 10000 }, async () => {
	const entered = deferred();
	const release = deferred();
	let called = false;
	const server = await listen([
		{
			method: 'GET',
			url: '/slow',

			async onRequest() {
				entered.resolve();
				await release.promise;
			},

			async handler(_req, reply) {
				called = true;
				reply.send({});
			},
		},
	]);
	try {
		const pending = send(server, 'GET', '/slow').catch((error) => error);
		await entered.promise;
		const lease = server.suspend();
		let drained = false;
		const drain = lease.drain().then(() => {
			drained = true;
		});
		await nextTurn();
		assert.equal(drained, false);
		release.resolve();
		await drain;
		assert.ok((await pending) instanceof Error);
		assert.equal(called, false);
	} finally {
		release.resolve();
		await server.close();
	}
});

test(
	'restore owner can drain, rebuild and reply while the retired Fastify instance closes later',
	{ timeout: 10000 },
	async () => {
		let server;
		server = await listen([
			{
				method: 'POST',
				url: '/restore',

				async handler(req, reply) {
					const lease = server.suspend(req.raw);
					await lease.drain();
					await lease.replace({
						routes: [
							{
								method: 'GET',
								url: '/fresh',

								async handler(_req, result) {
									result.send({ ready: true });
								},
							},
						],
					});
					lease.resume();
					reply.send({ restored: true });
				},
			},
		]);
		try {
			assert.deepEqual((await send(server, 'POST', '/restore', '{}')).json(), { restored: true });
			assert.deepEqual((await send(server, 'GET', '/fresh')).json(), { ready: true });
			assert.equal((await send(server, 'POST', '/restore', '{}')).status, 404);
		} finally {
			await server.close();
		}
	},
);

test(
	'asynchronous serialization and audit hooks preserve explicit JSON replies after handler returns',
	{ timeout: 10000 },
	async () => {
		let audited = false;
		const server = await listen([
			{
				method: 'GET',
				url: '/async-reply',

				async preSerialization(_req, _reply, payload) {
					await nextTurn();
					return payload;
				},

				async onSend(_req, _reply, payload) {
					await nextTurn();
					audited = true;
					return payload;
				},

				async handler(_req, reply) {
					reply.code(201).send({ created: true });
				},
			},
		]);
		try {
			const response = await send(server, 'GET', '/async-reply');
			assert.equal(response.status, 201);
			assert.deepEqual(response.json(), { created: true });
			assert.equal(audited, true);
		} finally {
			await server.close();
		}
	},
);

test(
	'callback early reply hooks finish without done and do not keep shutdown occupied',
	{ timeout: 10000 },
	async () => {
		const server = await listen([
			{
				method: 'GET',
				url: '/callback',

				onRequest(_req, reply, _done) {
					setImmediate(() => reply.code(403).send({ code: 'forbidden' }));
				},

				async handler(_req, reply) {
					reply.send({ unexpected: true });
				},
			},
		]);
		try {
			assert.deepEqual((await send(server, 'GET', '/callback')).json(), { code: 'forbidden' });
		} finally {
			await server.close();
		}
	},
);

test(
	'framework routing failures and unmatched bodies pass source policy with safe error envelopes',
	{ timeout: 10000 },
	async () => {
		let admissions = 0;
		const server = await openHttpListener({
			bindHost: '127.0.0.1',
			port: 0,
			publicOrigin: origin,
			trustedProxies: [],

			admitUnmatched: async () => {
				admissions++;
				return false;
			},

			routes: [
				{
					method: 'GET',
					url: '/p/:id',

					async handler(_req, reply) {
						reply.send({});
					},
				},
			],
		});
		try {
			for (const path of ['/p/%ZZ', '/p/' + 'x'.repeat(2049)]) {
				const rejectedHost = await send(server, 'GET', path, undefined, { Host: 'evil.invalid' });
				assert.equal(rejectedHost.status, 403);
				assert.deepEqual(rejectedHost.json(), { code: 'invalid_host' });
				const denied = await send(server, 'GET', path);
				assert.equal(denied.status, 403);
				assert.deepEqual(denied.json(), { code: 'forbidden' });
				assert.equal(denied.headers['cache-control'], 'no-store');
			}
			assert.equal(admissions, 2);
			const malformed = await send(server, 'POST', '/missing', '{');
			assert.equal(malformed.status, 403);
			assert.deepEqual(malformed.json(), { code: 'forbidden' });
			assert.equal(admissions, 3);
		} finally {
			await server.close();
		}
	},
);

test(
	'repeated failing reply hooks cannot expose framework error messages to the client',
	{ timeout: 10000 },
	async () => {
		const server = await listen([
			{
				method: 'GET',
				url: '/failed-hook',

				async onSend() {
					throw new Error('SECRET_TECHNICAL_CAUSE');
				},

				async handler(_req, reply) {
					reply.header('Set-Cookie', 'session=unconfirmed').send({ ok: true });
				},
			},
		]);
		try {
			const response = await send(server, 'GET', '/failed-hook');
			assert.equal(response.status, 500);
			assert.deepEqual(response.json(), { code: 'internal_failure' });
			assert.equal(response.headers['set-cookie'], undefined);
		} finally {
			await server.close();
		}
	},
);

test(
	'audit persistence failure preserves the committed response and remains a shutdown failure',
	{ timeout: 10000 },
	async () => {
		const cause = new Error('controlled audit persistence failure');
		const owner = new AuditEventOwner(
			{
				append: async () => {
					throw cause;
				},

				prune: async () => undefined,
			},
			{ record: async () => undefined },
			{
				fanout: async () => undefined,

				close: async () => undefined,
			},
		);
		const routes = observeOperationRoutes(
			[
				{
					method: 'POST',
					url: '/api/v1/targets/connections',

					async handler(_req, reply) {
						reply.code(201).send({ id: 1 });
					},
				},
			],
			(notice) => owner.publish(notice),
			(work) => owner.run(work),
			async () => null,
		);
		const server = await listen(routes);
		try {
			const response = await send(server, 'POST', '/api/v1/targets/connections', '{}');
			assert.equal(response.status, 201);
			assert.deepEqual(response.json(), { id: 1 });
		} finally {
			await server.close();
			await assert.rejects(
				owner.close(),
				(error) => error instanceof AggregateError && error.errors.includes(cause),
			);
		}
	},
);

test('refused audit publication remains observable when admitted audit work drains', { timeout: 10000 }, async () => {
	const release = deferred();
	const owner = new AuditEventOwner(
		{
			append: async () => {
				await release.promise;
				return { record: { event: 'HTTP_MUTATION', id: 1 } };
			},

			prune: async () => undefined,
		},
		{ record: async () => undefined },
		{
			fanout: async () => undefined,

			close: async () => undefined,
		},
	);
	const notice = {
		key: 'fixture',
		event: 'HTTP_MUTATION',
		userId: null,
		subjectId: null,
		sourceIp: '127.0.0.1',
		route: '/fixture',
		statusCode: 200,
	};
	const admitted = Array.from({ length: 256 }, () => owner.publish(notice));
	try {
		await assert.rejects(owner.publish(notice), (error) => error.code === 'limit_exceeded');
	} finally {
		release.resolve();
		await Promise.all(admitted);
		await assert.rejects(
			owner.close(),
			(error) =>
				error instanceof AggregateError && error.errors.some((failure) => failure.code === 'limit_exceeded'),
		);
	}
});

test(
	'Operations observes parser rejections and final failed reply-hook status with the original actor',
	{ timeout: 10000 },
	async () => {
		const notices = [];
		const requests = new Set();
		let entered = 0;
		const routes = observeOperationRoutes(
			[
				{
					method: 'POST',
					url: '/api/v1/auth/login',

					async handler(_request, reply) {
						entered++;
						reply.send({ user: { id: 1 } });
					},
				},
				{
					method: 'PUT',
					url: '/api/v1/targets/connections/:id',
					bodyLimit: 8,

					async handler(_request, reply) {
						entered++;
						reply.send({ updated: true });
					},
				},
				{
					method: 'POST',
					url: '/api/v1/auth/logout',

					async onSend() {
						throw new Error('controlled failed response hook');
					},

					async handler(_request, reply) {
						entered++;
						reply.send({ user: { id: 1 } });
					},
				},
			],
			async (notice) => {
				notices.push(notice);
			},
			(work) => {
				const task = Promise.resolve().then(work);
				requests.add(task);
				void task.finally(() => requests.delete(task)).catch(() => undefined);
				return task;
			},
			async (token) => (token === 'original' ? 1 : null),
		);
		const server = await listen(routes);
		try {
			const cases = [
				['POST', '/api/v1/auth/login', '{', {}, 400, 'LOGIN_FAILURE'],
				['PUT', '/api/v1/targets/connections/one', '{', {}, 400, 'HTTP_MUTATION_FAILED'],
				[
					'PUT',
					'/api/v1/targets/connections/two',
					'{}',
					{ 'Content-Type': 'text/plain' },
					415,
					'HTTP_MUTATION_FAILED',
				],
				['PUT', '/api/v1/targets/connections/three', '{"long":true}', {}, 413, 'HTTP_MUTATION_FAILED'],
				['POST', '/api/v1/auth/logout', '{}', {}, 500, 'HTTP_MUTATION_FAILED'],
			];
			for (const [method, path, body, headers, status, event] of cases) {
				const response = await send(server, method, path, body, {
					Cookie: 'nexus_session=original',
					...headers,
				});
				assert.equal(response.status, status);
				await nextTurn();
				assert.equal(notices.at(-1)?.event, event);
				assert.equal(notices.at(-1)?.statusCode, status);
				assert.equal(notices.at(-1)?.userId, path === '/api/v1/auth/login' ? null : 1);
			}
			assert.equal(entered, 1);
			assert.equal(notices.length, cases.length);
		} finally {
			await server.close();
			await Promise.allSettled([...requests]);
		}
	},
);

test('native Cookie parsing preserves opaque tokens and rejects ambiguous HTTP and WS identities across restore', async () => {
	const { createRequire } = await import('node:module');
	const WebSocket = createRequire(new URL('../../../packages/backend/package.json', import.meta.url))('ws');
	const routes = [
		{
			method: 'GET',
			url: '/cookies',

			async handler(request, reply) {
				return reply.send({
					token: readRequestCookie(request.raw, 'session'),
					native: request.cookies.session ?? null,
				});
			},
		},
	];
	const webSockets = [
		{
			path: '/cookies-ws',

			async authorize(request) {
				return readRequestCookie(request, 'session') === 'valid';
			},

			connected(channel) {
				channel.send('accepted');
			},
		},
	];
	const server = await openHttpListener({
		bindHost: '127.0.0.1',
		port: 0,
		publicOrigin: origin,
		trustedProxies: [],
		routes,
		webSockets,
	});

	const upgrade = (cookie) =>
		new Promise((resolve, reject) => {
			const ws = new WebSocket('ws://' + server.address + '/cookies-ws', {
				headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie },
				handshakeTimeout: 3000,
			});
			ws.on('unexpected-response', (_request, response) => {
				response.resume();
				ws.terminate();
				resolve(response.statusCode);
			});
			ws.on('error', reject);
			ws.on('message', (bytes) => {
				assert.equal(String(bytes), 'accepted');
				ws.close();
			});
			ws.once('close', () => resolve(101));
		});

	try {
		for (let generation = 0; generation < 2; generation++) {
			for (const [cookie, token, status] of [
				['session=valid', 'valid', 101],
				['other=x; session=valid', 'valid', 101],
				['session=valid; session=other', null, 401],
				['session=valid; session =other', null, 401],
				['session=%76alid', '%76alid', 401],
				['other=' + 'x'.repeat(8192) + '; session=valid', null, 401],
			]) {
				const response = await send(server, 'GET', '/cookies', undefined, { Cookie: cookie });
				assert.equal(response.status, 200);
				assert.deepEqual(response.json(), { token, native: token });
				assert.equal(await upgrade(cookie), status);
			}
			if (generation === 0) {
				const maintenance = server.suspend();
				await maintenance.drain();
				await maintenance.replace({ routes, webSockets });
				maintenance.resume();
			}
		}
	} finally {
		await server.close();
	}
});

test('native Cookie serialization keeps credential policy and drops credentials on delivery failure', async () => {
	const { serializeAccessCookie } =
		await import('../../../packages/backend/dist/modules/access/interfaces/http/access-cookie.js');
	const server = await listen([
		{
			method: 'GET',
			url: '/credentials/:kind',

			async preSerialization(request, _reply, payload) {
				if (request.params.kind === 'failed') throw new Error('private delivery detail');
				return payload;
			},

			async handler(request, reply) {
				return reply
					.header(
						'Set-Cookie',
						serializeAccessCookie(reply, 'session', 'opaque +/%', {
							secure: request.params.kind !== 'http',
							maxAge:
								request.params.kind === 'remember'
									? 600
									: request.params.kind === 'clear'
										? 0
										: undefined,
						}),
					)
					.send({ ok: true });
			},
		},
	]);
	try {
		for (const kind of ['http', 'https', 'remember', 'clear']) {
			const result = await send(server, 'GET', '/credentials/' + kind);
			assert.equal(result.status, 200);
			const cookie = result.headers['set-cookie'][0];
			assert.ok(cookie.startsWith('session=opaque%20%2B%2F%25;'));
			assert.match(cookie, /; Path=\//u);
			assert.match(cookie, /; HttpOnly/u);
			assert.match(cookie, /; SameSite=Lax/u);
			assert.equal(cookie.includes('; Secure'), kind !== 'http');
			assert.equal(cookie.includes('; Max-Age='), ['remember', 'clear'].includes(kind));
			if (kind === 'remember') assert.match(cookie, /; Max-Age=600(?:;|$)/u);
			if (kind === 'clear') assert.match(cookie, /; Max-Age=0(?:;|$)/u);
		}
		const failed = await send(server, 'GET', '/credentials/failed');
		assert.equal(failed.status, 500);
		assert.equal(failed.headers['set-cookie'], undefined);
		assert.deepEqual(failed.json(), { code: 'internal_failure' });
		assert.equal(failed.headers['x-content-type-options'], 'nosniff');
	} finally {
		await server.close();
	}
});

test('Helmet preserves plugin sandbox and raw SDK headers without adding incompatible defaults', async () => {
	const { createPluginContentRoutes } =
		await import('../../../packages/backend/dist/modules/agent/interfaces/http/plugin-http.js');
	const { sendHtmlThemeText } =
		await import('../../../packages/backend/dist/modules/preferences/interfaces/http/html-theme-http-support.js');
	const controller = new AbortController();
	const content = { bytes: Buffer.from('<p>fixture</p>'), sha256: 'a'.repeat(64) };
	const routes = createPluginContentRoutes(
		{
			sdkAsset: (_path, deliver) => deliver(content, controller.signal),

			asset: (_app, _version, _grant, _path, deliver) => deliver(content, controller.signal),
		},
		(work) => work(),
	);
	routes.push({
		method: 'GET',
		url: '/theme',

		async handler(request, reply) {
			await sendHtmlThemeText(request, reply, '<p>theme</p>', controller.signal);
		},
	});
	const server = await listen(routes);
	try {
		const id = '11111111-1111-4111-8111-111111111111';
		const asset = await send(server, 'GET', `/plugins/${id}/1.0.0/${id}/index.html`);
		assert.equal(asset.status, 200);
		assert.equal(asset.headers['referrer-policy'], 'no-referrer');
		assert.equal(asset.headers['cross-origin-resource-policy'], 'cross-origin');
		assert.equal(asset.headers['access-control-allow-origin'], '*');
		assert.equal(asset.bytes.toString(), content.bytes.toString());
		assert.deepEqual(
			new Set(asset.headers['content-security-policy'].split(';').map((item) => item.trim())),
			new Set([
				'sandbox allow-scripts',
				"default-src 'none'",
				"script-src 'self'",
				"style-src 'self'",
				"img-src 'self' data:",
				"font-src 'self'",
				"connect-src 'none'",
				"object-src 'none'",
				"base-uri 'none'",
				"form-action 'none'",
				"frame-ancestors 'self'",
			]),
		);
		const sdk = await send(server, 'GET', '/sdk/frontend-v1.mjs');
		assert.equal(sdk.status, 200);
		assert.equal(sdk.headers['cross-origin-resource-policy'], 'cross-origin');
		assert.equal(sdk.headers['access-control-allow-origin'], '*');
		assert.equal(sdk.headers['content-security-policy'], undefined);
		const theme = await send(server, 'GET', '/theme');
		assert.equal(theme.status, 200);
		assert.equal(theme.bytes.toString(), '<p>theme</p>');
		assert.deepEqual(
			new Set(theme.headers['content-security-policy'].split(';').map((item) => item.trim())),
			new Set(['sandbox', "default-src 'none'", "base-uri 'none'", "form-action 'none'"]),
		);
		for (const response of [asset, sdk, theme]) {
			assert.equal(response.headers['x-content-type-options'], 'nosniff');
			for (const name of [
				'x-frame-options',
				'strict-transport-security',
				'cross-origin-embedder-policy',
				'cross-origin-opener-policy',
			]) {
				assert.equal(response.headers[name], undefined, name + ' is not silently introduced');
			}
		}
	} finally {
		await server.close();
	}
});
