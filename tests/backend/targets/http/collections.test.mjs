import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRequire } from 'node:module';
const requireBackend = createRequire(new URL('../../../../packages/backend/package.json', import.meta.url));
const fastify = requireBackend('fastify');

test('installed target collection routes enforce complete responses and accept maximum valid collections', async () => {
	// Controlled public collection producer; exercise the installed HTTP handler and safe response, without a database write loop.
	const { createTargetsRoutes } =
		await import('../../../../packages/backend/src/modules/targets/interfaces/http/target-http.ts');
	const { TARGET_MANAGEMENT_MAX_ITEMS, TARGET_MANAGEMENT_RESPONSE_MAX_BYTES } =
		await import('../../../../packages/shared/src/targets/values.ts');
	let producerItems = [];
	const producerRoutes = createTargetsRoutes(
		{ authenticate: async () => ({ userId: 1 }) },
		{
			list: async () => producerItems,

			proxies: { list: async () => producerItems },
			sshKeys: { list: async () => producerItems },
			tags: { list: async () => producerItems },
			hostKeys: { list: async () => producerItems },
		},
		{ run: async (_actor, action) => action() },
	);
	let producerResult;
	const producerServer = fastify({ routerOptions: { querystringParser: (query) => new URLSearchParams(query) } });
	const { bindRequestCookies } = await import('../../../../packages/backend/src/platform/http/http-request.ts');
	await producerServer.register(requireBackend('@fastify/cookie'));
	producerServer.addHook('onRequest', (request, _reply, done) => {
		bindRequestCookies(request.raw, request.cookies);
		done();
	});
	for (const route of producerRoutes) {
		producerServer.route(route);
	}

	async function readProducerList(url) {
		const response = await producerServer.inject({
			method: 'GET',
			url,
			headers: { cookie: 'nexus_session=isolated-token' },
		});
		producerResult = { status: response.statusCode, body: response.json() };
	}

	try {
		const producerProxy = {
			id: 1,
			name: 'proxy',
			type: 'HTTP',
			host: '127.0.0.1',
			port: 8080,
			username: null,
			version: 1,
			createdAt: 1,
			updatedAt: 1,
		};
		producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
			...producerProxy,
			id: index + 1,
		}));
		await readProducerList('/api/v1/targets/proxies');
		assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
		producerItems = [
			{
				id: 1,
				name: 'x'.repeat(TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['ssh-keys']),
				version: 1,
				createdAt: 1,
				updatedAt: 1,
			},
		];
		await readProducerList('/api/v1/targets/ssh-keys');
		assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
		producerItems = [];

		producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
			id: index + 1,
			name: 'tag',
			version: 1,
			createdAt: 1,
			updatedAt: 1,
		}));
		await readProducerList('/api/v1/targets/tags');
		assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
		producerItems = [
			{
				id: 1,
				name: 'x'.repeat(TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.tags),
				version: 1,
				createdAt: 1,
				updatedAt: 1,
			},
		];
		await readProducerList('/api/v1/targets/tags');
		assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
		producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS }, (_, index) => ({
			id: index + 1,
			name: '\u0001'.repeat(128),
			version: Number.MAX_SAFE_INTEGER,
			createdAt: Number.MAX_SAFE_INTEGER,
			updatedAt: Number.MAX_SAFE_INTEGER,
		}));
		await readProducerList('/api/v1/targets/tags');
		assert.equal(producerResult.status, 200);
		const { readTagList } = await import('../../../../packages/shared/src/targets/tags/http-codec.ts');
		assert.equal(readTagList(producerResult.body).length, TARGET_MANAGEMENT_MAX_ITEMS);
		producerItems = [];

		producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
			host: index + '.example',
			port: 22,
			fingerprint: 'SHA256:' + 'A'.repeat(43),
			confirmedAt: 0,
		}));
		await readProducerList('/api/v1/targets/host-keys');
		assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
		producerItems = [
			{
				host: 'x'.repeat(TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['host-keys']),
				port: 22,
				fingerprint: 'SHA256:' + 'A'.repeat(43),
				confirmedAt: 0,
			},
		];
		await readProducerList('/api/v1/targets/host-keys');
		assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
		producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS }, (_, index) => ({
			host: String(index).padStart(5, '0') + '\\'.repeat(248),
			port: 65535,
			fingerprint: 'SHA256:' + 'A'.repeat(43),
			confirmedAt: Number.MAX_SAFE_INTEGER,
		}));
		await readProducerList('/api/v1/targets/host-keys');
		assert.equal(producerResult.status, 200);
		const { readHostKeyList } = await import('../../../../packages/shared/src/targets/host-keys/http-codec.ts');
		assert.equal(readHostKeyList(producerResult.body).length, TARGET_MANAGEMENT_MAX_ITEMS);
		producerItems = [];

		const producerConnection = {
			id: 1,
			version: 1,
			createdAt: 0,
			updatedAt: 0,
			lastConnectedAt: null,
			name: 'connection',
			type: 'SSH',
			host: 'localhost',
			port: 22,
			username: 'user',
			route: 'direct',
			proxyId: null,
			notes: null,
			tagIds: [],
			jumpIds: [],
		};
		producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
			...producerConnection,
			id: index + 1,
		}));
		await readProducerList('/api/v1/targets/connections');
		assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
		producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS }, (_, index) => ({
			...producerConnection,
			id: index + 1,
		}));
		await readProducerList('/api/v1/targets/connections');
		const { readConnectionList } =
			await import('../../../../packages/shared/src/targets/connections/http-codec.ts');
		assert.equal(producerResult.status, 200);
		assert.equal(readConnectionList(producerResult.body).length, TARGET_MANAGEMENT_MAX_ITEMS);
		producerItems = [];
	} finally {
		await producerServer.close();
	}
});
