import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
	agentHttpSerializer,
	agentHttpErrorHandler,
	AgentHttpSerializationFailure,
	AgentRpcHttpSerializationFailure,
} from '../../../packages/backend/dist/modules/agent/interfaces/http/agent-http-response.js';
import { createPluginHttpRoutes } from '../../../packages/backend/dist/modules/agent/interfaces/http/plugin-http.js';
import { createArtifactHttpRoutes } from '../../../packages/backend/dist/modules/agent/interfaces/http/artifact-http.js';
import { openHttpListener } from '../../../packages/backend/dist/platform/http/http-server.js';
import { bindRequestCookies } from '../../../packages/backend/dist/platform/http/http-request.js';
import { AGENT_PLUGIN_MAX_RESPONSE_BYTES } from '../../../packages/shared/dist/agent/plugins/values.js';
import { AGENT_ARTIFACT_MAX_RESPONSE_BYTES } from '../../../packages/shared/dist/agent/artifacts/values.js';

const require = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const Fastify = require('fastify');

test('committed artifact deletion retains operation_unknown after native serialization fails', async () => {
	let writes = 0;
	const route = createArtifactHttpRoutes(
		{ authenticate: async () => ({ userId: 1 }) },
		{
			delete: async () => {
				writes++;
			},
		},
		(work) => work(),
	).find((entry) => entry.method === 'DELETE' && entry.url.endsWith('/:artifactId'));
	const origin = 'http://127.0.0.1:0';
	const server = await openHttpListener({
		bindHost: '127.0.0.1',
		port: 0,
		publicOrigin: origin,
		trustedProxies: [],
		routes: [
			{
				...route,

				async preSerialization(_request, reply, payload) {
					return reply.statusCode === 200
						? { expanded: 'x'.repeat(AGENT_ARTIFACT_MAX_RESPONSE_BYTES) }
						: payload;
				},
			},
		],
	});
	try {
		const id = '11111111-1111-4111-8111-111111111111';
		const body = JSON.stringify({ expectedVersion: 1 });
		const response = await new Promise((resolve, reject) => {
			const req = request(
				'http://' + server.address + `/api/v1/agent/apps/${id}/artifacts/${id}`,
				{
					method: 'DELETE',
					headers: {
						Host: new URL(origin).host,
						Origin: origin,
						Cookie: 'nexus_session=test',
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(body),
					},
				},
				(res) => {
					const chunks = [];
					res.on('data', (chunk) => chunks.push(chunk));
					res.on('error', reject);
					res.on('end', () =>
						resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })),
					);
				},
			);
			req.on('error', reject);
			req.end(body);
		});
		assert.equal(writes, 1);
		assert.equal(response.status, 503);
		assert.deepEqual(await response.json(), { code: 'operation_unknown' });
	} finally {
		await server.close();
	}
});

test('Agent serializer encodes the payload transformed by preSerialization exactly once', async () => {
	const app = Fastify();
	let encodings = 0;
	let observed;
	app.route({
		method: 'GET',
		url: '/',
		errorHandler: agentHttpErrorHandler,

		async preSerialization(_request, _reply, payload) {
			observed = payload;
			return {
				toJSON() {
					encodings++;
					return { text: '中文' };
				},
			};
		},

		async handler(_request, reply) {
			return reply
				.type('application/json; charset=utf-8')
				.serializer(agentHttpSerializer(17))
				.send({ original: true });
		},
	});
	try {
		const response = await app.inject('/');
		assert.equal(response.statusCode, 200);
		assert.match(response.headers['content-type'], /^application\/json/u);
		assert.deepEqual(observed, { original: true });
		assert.deepEqual(response.json(), { text: '中文' });
		assert.equal(Buffer.byteLength(response.body), 17);
		assert.equal(encodings, 1);
	} finally {
		await app.close();
	}
});

test('Agent serializer budgets the transformed UTF-8 payload and removes pending credentials on overflow', async () => {
	const app = Fastify();
	let failure;
	app.route({
		method: 'GET',
		url: '/',

		errorHandler(error, request, reply) {
			failure = error;
			return agentHttpErrorHandler.call(this, error, request, reply);
		},

		async preSerialization(_request, _reply, payload) {
			return payload.code ? payload : { text: '中文' };
		},

		async handler(_request, reply) {
			reply.header('Set-Cookie', 'secret=hidden').header('Content-Length', '999');
			return reply.type('application/json; charset=utf-8').serializer(agentHttpSerializer(16)).send({});
		},
	});
	try {
		const response = await app.inject('/');
		assert.equal(response.statusCode, 413);
		assert.deepEqual(response.json(), { code: 'limit_exceeded' });
		assert.equal(response.headers['set-cookie'], undefined);
		assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body));
		assert.ok(failure instanceof AgentHttpSerializationFailure);
		assert.ok(failure.cause instanceof Error);
	} finally {
		await app.close();
	}
});

test('Agent serializer preserves a real serialization exception as its cause', async () => {
	const app = Fastify();
	const cause = new Error('private producer failure');
	let observed;
	app.route({
		method: 'GET',
		url: '/',

		errorHandler(error, request, reply) {
			observed = error;
			return agentHttpErrorHandler.call(this, error, request, reply);
		},

		async handler(_request, reply) {
			return reply
				.type('application/json; charset=utf-8')
				.serializer(agentHttpSerializer(1024))
				.send({
					toJSON() {
						throw cause;
					},
				});
		},
	});
	try {
		const response = await app.inject('/');
		assert.equal(response.statusCode, 413);
		assert.deepEqual(response.json(), { code: 'limit_exceeded' });
		assert.equal(observed.cause, cause);
		assert.ok(!response.body.includes(cause.message));
	} finally {
		await app.close();
	}
});

test('Agent plugin configuration write keeps operation_unknown when a post-hook response exceeds its budget', async () => {
	const app = Fastify({ routerOptions: { querystringParser: (query) => new URLSearchParams(query) } });
	await app.register(require('@fastify/cookie'));
	app.addHook('onRequest', async (request) => bindRequestCookies(request.raw, request.cookies));
	let writes = 0;
	const access = { authenticate: async () => ({ userId: 1 }) };
	const service = {
		write: async () => {
			writes++;
			return {
				changed: true,
				configuration: {
					instanceId: '00000000-0000-4000-8000-000000000002',
					packageId: 'test.browser',
					revision: 2,
					schemaRevision: 1,
					documentJson: '{}',
				},
			};
		},
	};
	app.addHook('preSerialization', async (_request, _reply, payload) =>
		payload.code ? payload : { expanded: 'x'.repeat(AGENT_PLUGIN_MAX_RESPONSE_BYTES) },
	);
	for (const route of createPluginHttpRoutes(access, null, null, service, null, (work) => work())) {
		// The installed Platform handler awaits the native reply while asynchronous hooks finish.
		app.route({
			...route,

			async handler(request, reply) {
				await route.handler.call(this, request, reply);
				return reply;
			},
		});
	}
	try {
		const response = await app.inject({
			method: 'PUT',
			url: '/api/v1/agent/plugins/apps/00000000-0000-4000-8000-000000000001/instances/00000000-0000-4000-8000-000000000002/configuration',
			headers: { cookie: 'nexus_session=test' },
			payload: {
				operationKey: '00000000-0000-4000-8000-000000000003',
				expectedPackageRevision: 1,
				expectedRevision: 1,
				schemaRevision: 1,
				documentJson: '{}',
			},
		});
		assert.equal(writes, 1);
		assert.equal(response.statusCode, 503);
		assert.deepEqual(response.json(), { code: 'operation_unknown' });
	} finally {
		await app.close();
	}
});

test('Agent RPC serialization refusal keeps the original exchange envelope and unknown-write status', async () => {
	const app = Fastify();
	app.route({
		method: 'POST',
		url: '/',
		errorHandler: agentHttpErrorHandler,

		async handler(_request, reply) {
			return reply
				.type('application/json; charset=utf-8')
				.serializer((payload) => {
					try {
						return agentHttpSerializer(8)(payload);
					} catch (cause) {
						throw new AgentRpcHttpSerializationFailure(
							'operation_unknown',
							cause,
							'original-nonce',
							'original-id',
							7,
						);
					}
				})
				.send({ successfulWrite: true });
		},
	});
	try {
		const response = await app.inject({ method: 'POST', url: '/' });
		assert.equal(response.statusCode, 503);
		assert.deepEqual(response.json(), {
			type: 'nexus.plugin.response',
			protocol: 4,
			nonce: 'original-nonce',
			id: 'original-id',
			seq: 7,
			ok: false,
			error: { code: 'operation_unknown' },
		});
	} finally {
		await app.close();
	}
});

test('Agent route delegates unrelated hook failures to its parent error handler', async () => {
	const app = Fastify();
	const cause = new Error('private hook failure');
	let observed;
	app.setErrorHandler((error, _request, reply) => {
		observed = error;
		reply
			.serializer(JSON.stringify)
			.type('application/json; charset=utf-8')
			.code(500)
			.send({ code: 'internal_failure' });
	});
	app.route({
		method: 'GET',
		url: '/',
		errorHandler: agentHttpErrorHandler,

		async preSerialization(_request, _reply, payload) {
			if (!payload.code) throw cause;
			return payload;
		},

		async handler(_request, reply) {
			return reply
				.type('application/json; charset=utf-8')
				.serializer(agentHttpSerializer(1024))
				.send({ value: true });
		},
	});
	try {
		const response = await app.inject('/');
		assert.equal(response.statusCode, 500);
		assert.deepEqual(response.json(), { code: 'internal_failure' });
		assert.equal(observed, cause);
	} finally {
		await app.close();
	}
});
