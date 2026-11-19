import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PluginTestHost } from './plugin-test-host.js';
import { HttpApi, HttpFailure } from '../../../src/http/node/http-api.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';

async function assertProblem(response: Response, status: number, code: string): Promise<void> {
	assert.equal(response.status, status);
	assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/u);
	assert.deepEqual(await response.json(), { type: 'about:blank', status, code });
}

test('插件的 SQL 查询路由随启动、停用和重载登记', async () => {
	const dataDirectory = await mkdtemp(join(tmpdir(), 'nexus-plugin-http-'));
	const host = new PluginTestHost({ dataDirectory, logLevel: 'fatal' });
	const pluginId = '@nexus-terminal/test';
	const plugin = fileURLToPath(new URL('../../fixtures/plugins/test/', import.meta.url));
	try {
		await host.initialize();
		const origin = host.services.get('http').origin;
		const url = `${origin}/api/plugins/${encodeURIComponent(pluginId)}/items`;
		await assertProblem(await fetch(url), 404, 'HTTP_NOT_FOUND');
		await host.runtime.start([plugin]);
		const runtime = host.runtime;
		await assertProblem(await fetch(url), 401, 'AUTH_REQUIRED');
		const login = await fetch(`${origin}/api/auth/initialize`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: 'test', password: 'test-only' }),
		});
		assert.equal(login.status, 201);
		await login.arrayBuffer();
		const cookie = login.headers.get('set-cookie')?.split(';')[0];
		assert.ok(cookie);
		const headers = { Cookie: cookie };
		const first = await fetch(`${url}?limit=1`, { headers });
		assert.equal(first.status, 200);
		assert.deepEqual(await first.json(), { items: [{ id: 'sample', label: 'sample' }] });
		await assertProblem(await fetch(`${url}?limit=0`, { headers }), 400, 'HTTP_INVALID_REQUEST');
		await assertProblem(
			await fetch(url, { headers: { Origin: 'https://example.com' } }),
			403,
			'HTTP_ORIGIN_DENIED',
		);

		await runtime.stop(pluginId);
		await assertProblem(await fetch(url), 404, 'HTTP_NOT_FOUND');

		await runtime.reload(pluginId);
		const next = await fetch(url, { headers });
		assert.equal(next.status, 200);
		assert.deepEqual(await next.json(), { items: [{ id: 'sample', label: 'sample' }] });
	} finally {
		try {
			await host.close();
		} finally {
			await rm(dataDirectory, { recursive: true, force: true });
		}
	}
});

test('子作用域取消在途请求并等待处理结束，插件自己的路由仍可用', { timeout: 5000 }, async () => {
	const parent = new PluginScope(() => {});
	const child = new PluginScope(() => {});
	const http = new HttpApi({
		port: 0,
		services: {
			log: { report() {} },
			auth: { authenticate: async () => true },
		},
	});
	const started = Promise.withResolvers<AbortSignal>();
	const release = Promise.withResolvers<void>();
	try {
		await http.initialize(parent.signal);
		const prefix = `${http.origin}/api/plugins/%40test%2Fhttp`;
		const api = http.bind('@test/http', parent);
		const empty = z.object({});
		api.register([
			{
				method: 'get',
				path: '/ready',
				input: empty,
				output: empty,

				handler: () => ({}),
			},
		]);
		api.register([
			{
				method: 'get',
				path: '/pending',
				input: empty,
				output: empty,
				lifetime: child,

				async handler(_input, signal) {
					started.resolve(signal);
					await release.promise;
					return {};
				},
			},
		]);
		const pending = fetch(`${prefix}/pending`);
		const signal = await started.promise;
		assert.equal(signal.aborted, false);
		let closed = false;
		const closing = child.close().then(() => {
			closed = true;
		});
		assert.equal(signal.aborted, true);
		await assertProblem(await fetch(`${prefix}/pending`), 404, 'HTTP_NOT_FOUND');
		assert.equal(closed, false);
		release.resolve();
		await assertProblem(await pending, 503, 'HTTP_ROUTE_CLOSED');
		await closing;
		assert.equal((await fetch(`${prefix}/ready`)).status, 200);
	} finally {
		release.resolve();
		await child.close();
		await parent.close();
		await http.close();
	}
});

test('请求断开会取消处理，JSON 解析失败和非法出参返回稳定错误', { timeout: 5000 }, async () => {
	const scope = new PluginScope(() => {});
	const http = new HttpApi({
		port: 0,
		services: {
			log: { report() {} },
			auth: { authenticate: async () => true },
		},
	});
	const started = Promise.withResolvers<void>();
	const disconnected = Promise.withResolvers<unknown>();
	try {
		await http.initialize(scope.signal);
		const api = http.bind('test', scope);
		const url = `${http.origin}/api/plugins/test/submit`;
		const input = z.object({ value: z.string() });
		api.register([
			{
				method: 'post',
				path: '/submit',
				input,
				output: z.object({ value: z.string().min(2) }),

				async handler({ value }: z.output<typeof input>, signal: AbortSignal) {
					if (value === 'wait') {
						started.resolve();
						if (!signal.aborted) await once(signal, 'abort');
						disconnected.resolve(signal.reason);
					}
					return { value };
				},
			},
		]);
		const headers = { 'Content-Type': 'application/json' };
		await assertProblem(await fetch(url, { method: 'POST', headers, body: '{' }), 400, 'HTTP_INVALID_REQUEST');
		await assertProblem(
			await fetch(url, { method: 'POST', headers, body: JSON.stringify({ value: 'a' }) }),
			500,
			'HTTP_INTERNAL_ERROR',
		);

		const controller = new AbortController();
		const pending = assert.rejects(
			fetch(url, { method: 'POST', headers, body: JSON.stringify({ value: 'wait' }), signal: controller.signal }),
			{ name: 'AbortError' },
		);
		await started.promise;
		controller.abort();
		await pending;
		assert.match(String(await disconnected.promise), /HTTP_CLIENT_DISCONNECTED/u);
	} finally {
		await scope.close();
		await http.close();
	}
});

test('本体路由复用契约校验和转换，插件命名空间由宿主保留', async () => {
	const http = new HttpApi({
		port: 0,
		services: {
			log: { report() {} },
			auth: { authenticate: async () => true },
		},
	});
	try {
		await http.initialize(new AbortController().signal);
		const input = z.object({ value: z.coerce.number().int() });
		const output = z.object({ value: z.number().transform(String) });
		http.register([
			{
				method: 'get',
				path: '/example/:value',
				input,
				output,

				handler: ({ value }: z.output<typeof input>) => ({ value: value + 1 }),
			},
		]);
		assert.throws(
			() =>
				http.register([
					{
						method: 'get',
						path: '/plugins/example',
						input,
						output,

						handler: ({ value }: z.output<typeof input>) => ({ value }),
					},
				]),
			{ code: 'HTTP_ROUTE_PATH_RESERVED' },
		);
		const response = await fetch(`${http.origin}/api/example/41`);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { value: '42' });
	} finally {
		await http.close();
	}
});

test('授权在读取请求体之前执行，公开回调按注册项处理跨站导航', async () => {
	const http = new HttpApi({
		port: 0,
		services: {
			log: { report() {} },
			auth: { authenticate: async () => false },
		},
	});
	try {
		await http.initialize(new AbortController().signal);
		const empty = z.object({});
		http.register([
			{
				method: 'post',
				path: '/private',
				input: empty,
				output: empty,

				handler: () => ({}),
			},
		]);
		http.register([
			{
				policy: { access: 'callback' },
				method: 'get',
				path: '/callback-test',
				input: empty,
				output: empty,

				handler: () => ({}),
			},
		]);
		const origin = http.origin;
		await assertProblem(
			await fetch(`${origin}/api/private`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{',
			}),
			401,
			'AUTH_REQUIRED',
		);
		await assertProblem(
			await fetch(`${origin}/api/callback-test`, { headers: { Origin: 'https://example.com' } }),
			403,
			'HTTP_ORIGIN_DENIED',
		);
		const status = await new Promise<number | undefined>((resolve, reject) => {
			request(
				`${origin}/api/callback-test`,
				{
					headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' },
				},
				(response) => {
					response.resume();
					response.once('end', () => resolve(response.statusCode));
				},
			)
				.once('error', reject)
				.end();
		});
		assert.equal(status, 200);
	} finally {
		await http.close();
	}
});

test('本体与插件批量登记时每条路由独立校验，重复路径使整批失败', async () => {
	const scope = new PluginScope(() => {});
	const http = new HttpApi({
		port: 0,
		services: {
			log: { report() {} },
			auth: { authenticate: async (request) => request.get('authorization') === 'Bearer test' },
		},
	});
	const empty = z.object({});
	const count = z.object({ value: z.coerce.number().int() });
	const result = z.object({ name: z.string() });
	const hostRoute = {
		method: 'get',
		path: '/batch/:value',
		input: count,
		output: result,

		handler: ({ value }: z.output<typeof count>) => ({ name: value.toFixed(0) }),
	} as const;
	const privateRoute = {
		method: 'get',
		path: '/batch/private',
		input: empty,
		output: empty,

		handler: () => ({}),
	} as const;
	try {
		await http.initialize(scope.signal);
		const root = `${http.origin}/api`;
		assert.throws(
			() =>
				http.register([
					hostRoute,
					{
						method: 'get',
						path: '/batch/:name',
						input: empty,

						async handler() {},
					},
				]),
			{ code: 'HTTP_ROUTE_DUPLICATE' },
		);
		await assertProblem(await fetch(`${root}/batch/42`), 404, 'HTTP_NOT_FOUND');
		http.register([privateRoute, { ...hostRoute, policy: { access: 'public' } }]);
		assert.throws(() => http.register([{ ...privateRoute, path: '/not-published' }, hostRoute]), {
			code: 'HTTP_ROUTE_DUPLICATE',
		});
		await assertProblem(await fetch(`${root}/batch/private`), 401, 'AUTH_REQUIRED');
		const publicResponse = await fetch(`${root}/batch/42`);
		assert.equal(publicResponse.status, 200);
		assert.deepEqual(await publicResponse.json(), { name: '42' });
		await assertProblem(await fetch(`${root}/not-published`), 404, 'HTTP_NOT_FOUND');

		const plugin = http.bind('@test/batch', scope);
		assert.throws(() => plugin.register([privateRoute, { ...hostRoute, status: 400 }]), {
			code: 'HTTP_ROUTE_STATUS_INVALID',
		});
		await assertProblem(await fetch(`${root}/plugins/%40test%2Fbatch/batch/private`), 404, 'HTTP_NOT_FOUND');
		// 运行时的额外字段也不能给插件增加宿主注册权限。
		const requestedPublicRoute = { ...hostRoute, policy: { access: 'public' } };
		plugin.register([privateRoute, requestedPublicRoute]);
		const pluginUrl = `${root}/plugins/%40test%2Fbatch/batch/42`;
		await assertProblem(await fetch(pluginUrl), 401, 'AUTH_REQUIRED');
		const response = await fetch(pluginUrl, { headers: { authorization: 'Bearer test' } });
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { name: '42' });
		await scope.close();
		await assertProblem(await fetch(pluginUrl), 404, 'HTTP_NOT_FOUND');
		await assertProblem(await fetch(`${root}/plugins/%40test%2Fbatch/batch/private`), 404, 'HTTP_NOT_FOUND');
	} finally {
		await scope.close();
		await http.close();
	}
});

test('插件原生二进制上传、HEAD、Range 下载复用授权与撤销', { timeout: 5000 }, async () => {
	const scope = new PluginScope(() => {});
	const http = new HttpApi({
		port: 0,
		services: {
			log: { report() {} },
			auth: { authenticate: async (request) => request.get('authorization') === 'Bearer test' },
		},
	});
	const bytes = Buffer.alloc(2 * 1024 * 1024 + 1, 0x42);
	let uploaded = 0;
	try {
		await http.initialize(scope.signal);
		const api = http.bind('test', scope);
		const input = z.object({ id: z.string() });
		api.register([
			{
				method: 'put',
				path: '/file/:id',
				input,
				body: 'binary',

				async handler({ id }, { body, reply }) {
					if (id !== 'sample') throw new HttpFailure(404, 'FILE_NOT_FOUND');
					assert.ok(body);
					for await (const chunk of body) uploaded += chunk.length;
					await reply({ status: 204 });
				},
			},
			{
				method: 'get',
				path: '/file/:id',
				input,

				async handler(_input, { headers, reply }) {
					assert.equal(headers.range, 'bytes=0-2');
					await reply({
						status: 206,
						headers: {
							'content-range': `bytes 0-2/${bytes.length}`,
							'content-type': 'application/octet-stream',
						},
						body: Readable.from([bytes.subarray(0, 3)]),
					});
				},
			},
			{
				method: 'head',
				path: '/file/:id',
				input,

				async handler(_input, { reply }) {
					await reply({ headers: { 'content-length': bytes.length, 'accept-ranges': 'bytes' } });
				},
			},
			{
				method: 'get',
				path: '/failing',
				input: z.object({}),

				async handler(_input, { reply }) {
					async function* chunks() {
						yield await Promise.reject(new Error('source failed before sending a byte'));
					}

					await reply({ body: Readable.from(chunks()), headers: { 'content-length': 100 } });
				},
			},
			{
				method: 'get',
				path: '/upload-status',
				input: z.object({}),
				output: z.object({ uploaded: z.number().int() }),

				handler: () => ({ uploaded }),
			},
		]);
		const prefix = `${http.origin}/api/plugins/test`;
		const url = `${prefix}/file/sample`;
		const headers = { authorization: 'Bearer test' };
		await assertProblem(await fetch(url, { method: 'PUT', body: 'forbidden' }), 401, 'AUTH_REQUIRED');
		assert.equal(uploaded, 0);
		await assertProblem(
			await fetch(`${prefix}/file/missing`, {
				method: 'PUT',
				headers: { ...headers, 'content-type': 'application/octet-stream' },
				body: bytes,
			}),
			404,
			'FILE_NOT_FOUND',
		);
		const upload = await fetch(url, {
			method: 'PUT',
			headers: { ...headers, 'content-type': 'application/octet-stream' },
			body: bytes,
		});
		assert.equal(upload.status, 204);
		assert.equal(uploaded, bytes.length);
		const status = await fetch(`${prefix}/upload-status`, { headers });
		assert.equal(status.status, 200);
		assert.deepEqual(await status.json(), { uploaded: bytes.length });
		const head = await fetch(url, { method: 'HEAD', headers });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get('content-length'), String(bytes.length));
		assert.equal((await head.arrayBuffer()).byteLength, 0);
		const part = await fetch(url, { headers: { ...headers, range: 'bytes=0-2' } });
		assert.equal(part.status, 206);
		assert.equal(part.headers.get('content-range'), `bytes 0-2/${bytes.length}`);
		assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(0, 3));
		await assertProblem(await fetch(`${prefix}/failing`, { headers }), 500, 'HTTP_INTERNAL_ERROR');
		await scope.close();
		await assertProblem(await fetch(url, { headers }), 404, 'HTTP_NOT_FOUND');
	} finally {
		await scope.close();
		await http.close();
	}
});

test('停用取消只收到一部分请求体的上传，并等到处理函数完成清理', { timeout: 5000 }, async () => {
	const scope = new PluginScope(() => {});
	const http = new HttpApi({
		port: 0,
		services: {
			log: { report() {} },
			auth: { authenticate: async () => true },
		},
	});
	const accepted = Promise.withResolvers<void>();
	const cancelled = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	try {
		await http.initialize(scope.signal);
		http.bind('test', scope).register([
			{
				method: 'put',
				path: '/pending',
				input: z.object({}),
				body: 'binary',

				async handler(_input, { body, signal }) {
					assert.ok(body);
					try {
						for await (const _chunk of body) accepted.resolve();
					} finally {
						assert.equal(signal.aborted, true);
						cancelled.resolve();
						await release.promise;
					}
				},
			},
		]);
		const url = `${http.origin}/api/plugins/test/pending`;
		const controller = new AbortController();
		const response = Promise.withResolvers<number | undefined>();
		const upload = request(
			url,
			{
				method: 'PUT',
				headers: { 'content-type': 'application/octet-stream', 'content-length': 1024 },
				signal: controller.signal,
			},
			(result) => result.resume().once('end', () => response.resolve(result.statusCode)),
		);
		upload.on('error', () => response.resolve(undefined));
		try {
			upload.write('first chunk');
			await accepted.promise;
			let closed = false;
			const closing = scope.close().then(() => {
				closed = true;
			});
			await cancelled.promise;
			assert.equal(closed, false);
			release.resolve();
			assert.equal(await response.promise, 503);
			await closing;
		} finally {
			controller.abort();
		}
	} finally {
		release.resolve();
		await scope.close();
		await http.close();
	}
});
