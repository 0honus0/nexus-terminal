import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { buildRegistrySnapshot } from '../../../packages/backend/dist/modules/agent/providers/registry/registry-rules.js';
import { decodeRegistrySnapshot } from '../../../packages/backend/dist/modules/agent/providers/registry/adapters/sqlite/registry-row.js';
import {
	readAgentProviderView,
	readAgentProviderListResponse,
	readAgentDiscoveredModels,
} from '../../../packages/shared/dist/agent/providers/http-codec.js';
import { origin, send, expectStatus } from '../remote/openssh-fixture.mjs';

await test(
	'Provider capacity: large model sets survive discovery, create, restart, update and strict response decoding',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(
			join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'provider-capacity-'),
		);
		const modelIds = Array.from({ length: 1500 }, (_, i) => 'capacity-model-' + i);
		const modelServer = createServer((request, response) => {
			assert.equal(request.url, '/v1/models');
			response.setHeader('Content-Type', 'application/json');
			response.end(
				JSON.stringify({
					object: 'list',
					data: modelIds.map((id) => ({ id, object: 'model', owned_by: 'fixture' })),
				}),
			);
		});
		modelServer.listen(0, '127.0.0.1');
		await once(modelServer, 'listening');
		t.after(() => new Promise((resolve) => modelServer.close(resolve)));
		const database = join(directory, 'state.db');
		const encryptionKey = randomBytes(32);
		let app;
		let address;

		const boot = async () => {
			app = await createApp(database, { encryptionKey });
			address = await app.listenHttp({
				publicOrigin: origin,
				bindHost: '127.0.0.1',
				port: 0,
				trustedProxies: [],
			});
		};

		t.after(() => app?.close());
		await boot();
		const password = 'provider-capacity-fixture-password';
		expectStatus(
			await send(address, '', 'POST', '/api/v1/auth/setup', {
				username: 'capacity',
				password,
				confirmPassword: password,
			}),
			201,
		);
		const login = await send(address, '', 'POST', '/api/v1/auth/login', {
			username: 'capacity',
			password,
			rememberMe: false,
		});
		expectStatus(login, 200);
		const cookie = login.headers['set-cookie'].map((part) => part.split(';')[0]).join('; ');

		const api = (method, path, input) => send(address, cookie, method, '/api/v1/agent/ai/providers' + path, input);

		const input = {
			kind: 'openai-compatible',
			displayName: 'Large fixture provider',
			baseUrl: 'http://127.0.0.1:' + modelServer.address().port + '/v1',
			protocol: 'chat-completions',
			enabled: true,
			models: modelIds.slice(0, 800).map((id) => ({ id, supportsTools: true })),
		};
		let provider = readAgentProviderView(expectStatus(await api('POST', '', input), 201));
		assert.equal(provider.models.length, 800);
		assert.ok(Buffer.byteLength(JSON.stringify(provider)) > 32768, 'Exercise the former implicit 32 KiB decoder');
		const discovered = readAgentDiscoveredModels(
			expectStatus(await api('POST', '/' + provider.id + '/discover-models', {}), 200),
		);
		assert.equal(discovered.length, 1500);
		assert.deepEqual(new Set(discovered.map((model) => model.id)), new Set(modelIds));
		await app.close();
		app = null;
		await boot();
		let list = readAgentProviderListResponse(expectStatus(await api('GET', ''), 200));
		assert.equal(list.find((item) => item.id === provider.id).models.length, 800);
		provider = readAgentProviderView(
			expectStatus(
				await api('PATCH', '/' + provider.id, {
					expectedVersion: provider.version,
					models: input.models.slice(0, 600),
				}),
				200,
			),
		);
		assert.equal(provider.models.length, 600);
		list = readAgentProviderListResponse(expectStatus(await api('GET', ''), 200));
		assert.equal(list.find((item) => item.id === provider.id).models.length, 600);
		const duplicate = await api('PATCH', '/' + provider.id, {
			expectedVersion: provider.version,
			models: [input.models[0], input.models[0]],
		});
		assert.equal(duplicate.status, 400, 'Count-policy removal must preserve duplicate identity rejection');
	},
);

await test('Model registry persists more than 5000 validated entries without an independent count policy', () => {
	const entries = Array.from({ length: 5001 }, (_, index) => ({
		providerId: 'fixture',
		modelId: 'model-' + index,
		capabilities: { contextWindow: 32768, maxOutputTokens: 4096, supportsTools: true },
	}));
	const snapshot = buildRegistrySnapshot(entries, 'capacity-fixture', Date.now());
	const restored = decodeRegistrySnapshot(JSON.parse(JSON.stringify(snapshot)));
	assert.equal(Object.keys(restored.entries).length, 5001);
	assert.equal(restored.entries['fixture/model-5000'].contextWindow, 32768);
});
