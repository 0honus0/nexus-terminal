// @vitest-environment jsdom
import { beforeAll, afterAll, afterEach, test, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { proxiesApi } from '../../../../packages/frontend/src/features/proxies/api/proxies-api.ts';
import { sshKeysApi } from '../../../../packages/frontend/src/features/ssh-keys/api/ssh-keys-api.ts';
import { TargetRequestFailure } from '../../../../packages/frontend/src/client/targets/target-types.ts';
import { targetManagementResponseLimit } from '../../../../packages/shared/src/targets/http.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
	vi.unstubAllGlobals();
	server.resetHandlers();
});
afterAll(() => server.close());
const proxy = {
	id: 1,
	name: 'proxy',
	type: 'SOCKS5',
	host: '127.0.0.1',
	port: 1080,
	username: 'user',
	version: 1,
	createdAt: 10,
	updatedAt: 10,
};
const input = { name: 'proxy', type: 'SOCKS5', host: '127.0.0.1', port: 1080, username: 'user', password: '  ' };
const key = { id: 1, name: 'key', version: 1, createdAt: 10, updatedAt: 10 };

async function rejected(request) {
	const failure = await request.catch((cause) => cause);
	expect(failure).toBeInstanceOf(TargetRequestFailure);
	expect(failure).toMatchObject({ code: 'protocol_failure', outcome: 'unknown' });
}

test('current proxy update and key list decode before their invalid response variants', async () => {
	server.use(
		http.put('http://localhost/api/v1/targets/proxies/1', () =>
			HttpResponse.json({ status: 'updated', value: { ...proxy, version: 2 } }),
		),
		http.get('http://localhost/api/v1/targets/ssh-keys', () => HttpResponse.json([key])),
	);
	expect(await proxiesApi.update(proxy, input)).toEqual({ ...proxy, version: 2 });
	expect(await sshKeysApi.list()).toEqual([key]);
});

test.each([
	['wrong resource', { ...proxy, id: proxy.id + 100, version: proxy.version + 1 }],
	['skipped revision', { ...proxy, version: proxy.version + 2 }],
	['private field', { ...proxy, version: proxy.version + 1, password: 'leaked' }],
])('proxy update rejects %s and retains unknown effect semantics', async (_name, value) => {
	server.use(
		http.put('http://localhost/api/v1/targets/proxies/1', () => HttpResponse.json({ status: 'updated', value })),
	);
	await rejected(proxiesApi.update(proxy, input));
});

test('proxy safe error status must agree with its error code', async () => {
	server.use(
		http.get('http://localhost/api/v1/targets/proxies', () =>
			HttpResponse.json({ code: 'unauthenticated' }, { status: 500 }),
		),
	);
	await rejected(proxiesApi.list());
});

test.each([
	['duplicate identity', [key, key]],
	['inverted timestamp', [{ ...key, updatedAt: key.createdAt - 1 }]],
])('key collection rejects %s', async (_name, body) => {
	server.use(http.get('http://localhost/api/v1/targets/ssh-keys', () => HttpResponse.json(body)));
	await rejected(sshKeysApi.list());
});

test('proxy response declaration exceeding the real complete budget cancels the unconsumed stream', async () => {
	let cancelled = false;
	vi.stubGlobal(
		'fetch',
		async () =>
			new Response(
				new ReadableStream({
					cancel() {
						cancelled = true;
					},
				}),
				{
					headers: {
						'content-type': 'application/json',
						'content-length': String(targetManagementResponseLimit('/proxies') + 1),
					},
				},
			),
	);
	await rejected(proxiesApi.list());
	expect(cancelled).toBe(true);
});

test('pre-cancelled proxy write never dispatches or acquires unknown effect', async () => {
	const fetch = vi.fn();
	vi.stubGlobal('fetch', fetch);
	const controller = new AbortController();
	controller.abort();
	const failure = await proxiesApi.create(input, controller.signal).catch((cause) => cause);
	expect(failure).toBeInstanceOf(TargetRequestFailure);
	expect(failure).toMatchObject({ code: 'cancelled', outcome: 'not_dispatched' });
	expect(fetch).not.toHaveBeenCalled();
});
