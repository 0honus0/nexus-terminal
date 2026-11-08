import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { createTestAgentApp } from '../../../agent/runs/support/native-agent-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import { readAccessNeedsSetup } from '../../../../../packages/shared/dist/access/http.js';
import {
	readAgentAppListResponse,
	readAgentAppResponse,
} from '../../../../../packages/shared/dist/agent/scope/http-codec.js';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../../../packages/shared/dist/agent/scope/workspace-http-codec.js';
import {
	readAgentProviderView,
	readAgentProviderTestResponse,
} from '../../../../../packages/shared/dist/agent/providers/http-codec.js';

async function openDatabase(t) {
	const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, 'schema-startup-'));
	const started = performance.now();
	const f = await openManagement(directory);
	const timing = { setupMs: performance.now() - started, executeMs: null, drainMs: null };
	const executing = performance.now();
	t.after(async () => {
		timing.executeMs = performance.now() - executing;
		const draining = performance.now();
		try {
			await f.close();
		} finally {
			timing.drainMs = performance.now() - draining;
			await writeFile(join(directory, 'timings.json'), JSON.stringify(timing, null, 2));
		}
	});
	return { ...f, directory };
}

async function workspace(f, app, request) {
	const body = readAgentWorkspaceRequest({ appVersion: app.version, request });
	return readAgentWorkspaceResponse(
		expectStatus(await f.api('POST', '/api/v1/agent/apps/' + app.id + '/workspace', body), 200),
		app.id,
		body,
	).result;
}

test('Current schema initializes a clean database through the normal application startup', async (t) => {
	const f = await openDatabase(t);
	assert.equal(
		readAccessNeedsSetup(expectStatus(await f.api('GET', '/api/v1/auth/needs-setup'), 200)).needsSetup,
		false,
	);
	assert.deepEqual(readAgentAppListResponse(expectStatus(await f.api('GET', '/api/v1/agent/apps'), 200)), []);
	assert.deepEqual(expectStatus(await f.api('GET', '/api/v1/agent/app-definitions'), 200), []);
	const app = await createTestAgentApp(f.api, f.directory, 'Current schema', {
		deterministic: true,
		selectedRootIds: [],
	});
	const thread = await workspace(f, app, {
		method: 'agent.threads.create',
		params: { autoTitle: false, operationId: randomUUID(), title: 'Fresh thread' },
	});
	assert.equal(thread.method, 'agent.threads.create');
	assert.equal(thread.value.appId, app.id);
	assert.equal(thread.value.title, 'Fresh thread');
	assert.equal(thread.value.version, 1);
});

test('Reopening the schema preserves account, App, idempotent thread and encrypted Provider credentials', async (t) => {
	const credential = 'schema-probe-secret-' + randomUUID();
	const calls = [];
	const model = createServer((request, response) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.once('end', () => {
			calls.push({
				path: request.url,
				credential: request.headers.authorization,
				body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
			});
			if (request.headers.authorization !== 'Bearer ' + credential) {
				response.writeHead(401).end();
				return;
			}
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.end(
				'data: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }],
						usage: { prompt_tokens: 5, completion_tokens: 1 },
					}) +
					'\n\ndata: [DONE]\n\n',
			);
		});
	});
	t.after(() => new Promise((resolve, reject) => model.close((error) => (error ? reject(error) : resolve()))));
	model.listen(0, '127.0.0.1');
	await once(model, 'listening');
	const f = await openDatabase(t);
	const provider = readAgentProviderView(
		expectStatus(
			await f.api('POST', '/api/v1/agent/ai/providers', {
				kind: 'openai-compatible',
				displayName: 'Encrypted restart probe',
				baseUrl: 'http://127.0.0.1:' + model.address().port + '/v1',
				protocol: 'chat-completions',
				credential,
				enabled: true,
				models: [{ id: 'e2e-model', supportsTools: true }],
			}),
			201,
		),
	);
	const app = await createTestAgentApp(f.api, f.directory, 'Restart persistence', {
		deterministic: true,
		selectedRootIds: [],
	});
	const command = {
		method: 'agent.threads.create',
		params: { autoTitle: false, operationId: randomUUID(), title: 'Retained thread' },
	};
	const created = await workspace(f, app, command);
	await f.restart();
	await f.login();
	assert.deepEqual(readAgentAppResponse(expectStatus(await f.api('GET', '/api/v1/agent/apps/' + app.id), 200)), app);
	assert.deepEqual(
		readAgentProviderView(expectStatus(await f.api('GET', '/api/v1/agent/ai/providers/' + provider.id), 200)),
		provider,
	);
	assert.deepEqual(await workspace(f, app, command), created);
	const probe = readAgentProviderTestResponse(
		expectStatus(
			await f.api('POST', '/api/v1/agent/ai/providers/' + provider.id + '/test', { modelId: 'e2e-model' }),
			200,
		),
	);
	assert.equal(probe.ok, true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].path, '/v1/chat/completions');
	assert.equal(calls[0].credential, 'Bearer ' + credential);
	assert.equal(calls[0].body.model, 'e2e-model');
});
