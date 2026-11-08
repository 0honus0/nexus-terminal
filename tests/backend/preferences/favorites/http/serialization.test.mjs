import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import { createFavoriteRoutes } from '../../../../../packages/backend/src/modules/preferences/interfaces/http/favorite-http.ts';
import { FAVORITE_RESPONSE_MAX_BYTES } from '../../../../../packages/shared/src/preferences/favorites/values.ts';
import { bindRequestCookies } from '../../../../../packages/backend/src/platform/http/http-request.ts';

const requireBackend = createRequire(new URL('../../../../../packages/backend/package.json', import.meta.url));
const fastify = requireBackend('fastify');
const favorite = {
	id: 1,
	version: 1,
	name: 'root',
	path: '/root',
	lastUsedAt: null,
	createdAt: 1,
	updatedAt: 1,
};
const access = { authenticate: async (token) => (token === 'valid' ? { userId: 1 } : null) };
const headers = { cookie: 'nexus_session=valid' };

async function open(t, transform, record = favorite) {
	const app = fastify({ routerOptions: { querystringParser: (text) => new URLSearchParams(text) } });
	await app.register(requireBackend('@fastify/cookie'));
	app.addHook('onRequest', async (request) => bindRequestCookies(request.raw, request.cookies));
	const observed = [];
	let writes = 0;
	app.addHook('preSerialization', async (request, reply, payload) => {
		if (reply.statusCode < 400) {
			assert.equal(typeof payload, 'object', 'the observer receives the application object');
			observed.push(payload);
			return transform ? transform(payload) : payload;
		}
		return payload;
	});
	for (const route of createFavoriteRoutes(
		{
			list: async () => ({ entries: [record], nextOffset: null }),

			create: async () => {
				writes += 1;
				return favorite;
			},
		},
		access,
	)) {
		app.route(route);
	}
	t.onTestFinished(() => app.close());
	return {
		app,
		observed,

		writes: () => writes,
	};
}

await test('Preferences JSON serialization runs once after object observers', async (t) => {
	let serializations = 0;
	const f = await open(t, undefined, {
		...favorite,
		path: {
			toJSON() {
				serializations += 1;
				return '/root';
			},
		},
	});
	const response = await f.app.inject({ url: '/api/v1/favorite-paths', headers });
	assert.equal(response.statusCode, 200, response.body);
	assert.match(response.headers['content-type'], /^application\/json/u);
	assert.equal(response.json().entries[0].path, '/root');
	assert.equal(f.observed.length, 1);
	assert.equal(serializations, 1);
});

for (const mutation of [false, true]) {
	await test(`Preferences ${mutation ? 'committed write' : 'read'} response budget includes observer output`, async (t) => {
		const f = await open(t, () => ({ data: '界'.repeat(Math.ceil(FAVORITE_RESPONSE_MAX_BYTES / 3)) }));
		const response = await f.app.inject(
			mutation
				? { method: 'POST', url: '/api/v1/favorite-paths', headers, payload: { name: 'root', path: '/root' } }
				: { url: '/api/v1/favorite-paths', headers },
		);
		assert.equal(response.statusCode, mutation ? 503 : 413, response.body);
		assert.deepEqual(response.json(), { code: mutation ? 'operation_unknown' : 'limit_exceeded' });
		assert.match(response.headers['content-type'], /^application\/json/u);
		assert.equal(f.observed.length, 1);
		assert.equal(f.writes(), mutation ? 1 : 0);
	});
}

for (const mutation of [false, true]) {
	await test(`Preferences ${mutation ? 'committed write' : 'read'} serialization failure keeps a safe JSON receipt`, async (t) => {
		const f = await open(t, () => {
			const cyclic = {};
			cyclic.self = cyclic;
			return cyclic;
		});
		const response = await f.app.inject(
			mutation
				? { method: 'POST', url: '/api/v1/favorite-paths', headers, payload: { name: 'root', path: '/root' } }
				: { url: '/api/v1/favorite-paths', headers },
		);
		assert.equal(response.statusCode, 503, response.body);
		assert.deepEqual(response.json(), { code: mutation ? 'operation_unknown' : 'internal_failure' });
		assert.equal(f.writes(), mutation ? 1 : 0);
	});
}

await test('Preferences route error handler preserves Fastify parser rejection', async (t) => {
	const f = await open(t);
	const response = await f.app.inject({
		method: 'POST',
		url: '/api/v1/favorite-paths',
		headers: { ...headers, 'content-type': 'application/json' },
		payload: '{',
	});
	assert.equal(response.statusCode, 400, response.body);
	assert.equal(f.writes(), 0);
	assert.equal(f.observed.length, 0);
});
