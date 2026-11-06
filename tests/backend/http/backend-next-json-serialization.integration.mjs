import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { createSystemStatusRoutes } from '../../../packages/backend/dist/modules/system/interfaces/http/status-http.js';
import { createFactorRoutes } from '../../../packages/backend/dist/modules/access/interfaces/http/factor-http.js';
import { SYSTEM_STATUS_MAX_RESPONSE_BYTES } from '../../../packages/shared/dist/system/status/values.js';
import { ACCESS_FACTOR_RESPONSE_MAX_BYTES } from '../../../packages/shared/dist/access/values.js';
import { openHttpListener } from '../../../packages/backend/dist/platform/http/http-server.js';

async function withServer(route, replacement, run) {
	const origin = 'http://127.0.0.1:0';
	const app = await openHttpListener({
		bindHost: '127.0.0.1',
		port: 0,
		publicOrigin: origin,
		trustedProxies: [],
		routes: [
			{
				...route,

				async preSerialization(_request, reply, payload) {
					return reply.statusCode < 300 ? replacement(payload) : payload;
				},
			},
		],
	});
	try {
		await run(
			(path, options = {}) =>
				new Promise((resolve, reject) => {
					const req = request(
						'http://' + app.address + path,
						{
							method: options.method,
							headers: { Host: new URL(origin).host, Origin: origin, ...options.headers },
						},
						(response) => {
							const chunks = [];
							response.on('data', (chunk) => chunks.push(chunk));
							response.on('error', reject);
							response.on('end', () =>
								resolve(
									new Response(Buffer.concat(chunks), {
										status: response.statusCode,
										headers: response.headers,
									}),
								),
							);
						},
					);
					req.on('error', reject);
					req.end(options.body);
				}),
		);
	} finally {
		await app.close();
	}
}

await test('JSON budget uses the final preSerialization payload and encodes it once', async () => {
	const route = createSystemStatusRoutes({ collect: async () => ({ cpuModel: 'original' }) })[1];
	let encodings = 0;
	await withServer(
		route,
		() => ({
			toJSON() {
				encodings++;
				return { cpuModel: 'hook replacement' };
			},
		}),
		async (send) => {
			const response = await send(route.url);
			assert.equal(response.status, 200);
			assert.match(response.headers.get('content-type'), /^application\/json/u);
			assert.deepEqual(await response.json(), { cpuModel: 'hook replacement' });
			assert.equal(encodings, 1);
		},
	);
});

await test('A hook cannot replace a bounded status response with an oversized response', async () => {
	const route = createSystemStatusRoutes({ collect: async () => ({ cpuModel: 'original' }) })[1];
	await withServer(
		route,
		() => ({ cpuModel: 'x'.repeat(SYSTEM_STATUS_MAX_RESPONSE_BYTES) }),
		async (send) => {
			const response = await send(route.url);
			assert.equal(response.status, 503);
			assert.deepEqual(await response.json(), { code: 'remote_unavailable' });
		},
	);
});

await test('Oversized final Passkey options remove the cookie and revoke the committed challenge', async () => {
	let revoked;
	const revocation = new Promise((resolve) => {
		revoked = resolve;
	});
	const factors = {
		registrationOptions: async () => ({
			cookie: 'committed-challenge',
			options: {
				challenge: 'challenge',
				rp: { name: 'Nexus', id: 'localhost' },
				user: { id: 'user', name: 'admin', displayName: 'admin' },
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			},
		}),

		logoutFlows: async (partial, challenge, setup) => {
			revoked({ partial, challenge, setup });
		},
	};
	const route = createFactorRoutes(factors, false).find((value) => value.url.endsWith('/registration-options'));
	await withServer(
		route,
		() => ({ challenge: 'x'.repeat(ACCESS_FACTOR_RESPONSE_MAX_BYTES) }),
		async (send) => {
			const response = await send(route.url, { method: 'POST' });
			assert.equal(response.status, 429);
			assert.equal(response.headers.get('set-cookie'), null);
			assert.deepEqual(await response.json(), { code: 'limit_exceeded' });
			assert.deepEqual(await revocation, { partial: null, challenge: 'committed-challenge', setup: null });
		},
	);
});
