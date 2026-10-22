import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import {
	readAgentCreateRunResponse,
	readAgentCancelRunResponse,
	readAgentRunResponse,
	readAgentRunEventsResponse,
} from '../../../packages/shared/dist/agent/runs/http-codec.js';

const publicOrigin = 'http://127.0.0.1:0';
const password = 'b10-isolated-password-123';

function send(address, method, path, body, cookie = '', headers = {}) {
	const bytes = Buffer.isBuffer(body) ? body : body === undefined ? undefined : Buffer.from(JSON.stringify(body));
	return new Promise((resolve, reject) => {
		const req = request(
			'http://' + address + path,
			{
				method,
				headers: {
					Host: new URL(publicOrigin).host,
					Origin: publicOrigin,
					Cookie: cookie,
					...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.byteLength } : {}),
					...headers,
				},
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () => {
					try {
						const data = Buffer.concat(chunks);
						resolve({
							status: response.statusCode,
							headers: response.headers,
							bytes: data,
							body: response.headers['content-type']?.includes('application/json')
								? JSON.parse(data.toString('utf8'))
								: null,
						});
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on('error', reject);
		req.setTimeout(15000, () => req.destroy(new Error('B10 HTTP deadline exceeded')));
		req.end(bytes);
	});
}

function expectStatus(response, status) {
	assert.equal(response.status, status, JSON.stringify(response.body));
	return response.body;
}

async function until(read, accept) {
	const deadline = performance.now() + 5000;
	let latest;
	do {
		latest = await read();
		if (accept(latest)) {
			return latest;
		}
		await delay(20);
	} while (performance.now() < deadline);
	assert.fail('B10 state deadline exceeded: ' + JSON.stringify(latest));
}

await test('B10 installed backend-next HTTP, durable state and model execution', { timeout: 60000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-http-'));
	const key = randomBytes(32);
	let app;
	let cookie = '';
	let provider;
	let agentApp;
	let thread;
	let command;
	let hold = false;
	const calls = [];
	const modelServer = createServer(async (req, response) => {
		const chunks = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const call = { body: JSON.parse(Buffer.concat(chunks).toString('utf8')), closed: false };
		calls.push(call);
		response.on('close', () => {
			call.closed = true;
		});
		response.writeHead(200, { 'Content-Type': 'text/event-stream' });
		response.flushHeaders();
		if (!hold) {
			response.end(
				'data: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: { content: 'B10 complete' }, finish_reason: null }],
					}) +
					'\n\ndata: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
						usage: { prompt_tokens: 12, completion_tokens: 3 },
					}) +
					'\n\ndata: [DONE]\n\n',
			);
		}
	});
	let address;

	const api = (method, path, body, headers) => send(address, method, path, body, cookie, headers);

	try {
		modelServer.listen(0, '127.0.0.1');
		await once(modelServer, 'listening');
		const dbPath = join(directory, 'backend-next.db');
		app = await createApp(dbPath, { encryptionKey: key });
		address = await app.listenHttp({ publicOrigin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });

		await t.test('Access denies anonymous/cross-origin writes and issues a real revocable session', async () => {
			expectStatus(await api('GET', '/api/v1/quick-commands'), 401);
			assert.equal(expectStatus(await api('GET', '/api/v1/auth/needs-setup'), 200).needsSetup, true);
			assert.equal(
				expectStatus(
					await api(
						'POST',
						'/api/v1/auth/setup',
						{
							username: 'admin',
							password,
							confirmPassword: password,
						},
						{ Origin: 'http://other.invalid' },
					),
					403,
				).code,
				'csrf_rejected',
			);
			expectStatus(
				await api('POST', '/api/v1/auth/setup', { username: 'admin', password, confirmPassword: password }),
				201,
			);
			const login = await api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });
			expectStatus(login, 200);
			cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
			assert.equal(expectStatus(await api('GET', '/api/v1/auth/status'), 200).isAuthenticated, true);
		});

		await t.test('Preferences normalizes tag input and enforces command CAS and usage', async () => {
			const tag = expectStatus(await api('POST', '/api/v1/quick-command-tags', { name: '  ops  ' }), 201).tag;
			assert.equal(tag.name, 'ops');
			const input = { name: 'B10 command', command: 'printf hello', variables: {}, tagIds: [tag.id] };
			command = expectStatus(await api('POST', '/api/v1/quick-commands', input), 201).command;
			const incremented = expectStatus(
				await api('POST', `/api/v1/quick-commands/${command.id}/increment-usage`, {
					expectedVersion: command.version,
				}),
				200,
			).command;
			assert.equal(incremented.usageCount, 1);
			assert.equal(incremented.version, command.version + 1);
			assert.equal(
				expectStatus(
					await api('PUT', `/api/v1/quick-commands/${command.id}`, {
						...input,
						expectedVersion: command.version,
					}),
					409,
				).code,
				'version_conflict',
			);
			const listed = expectStatus(await api('GET', '/api/v1/quick-commands'), 200);
			assert.deepEqual(listed.entries, [incremented]);
			command = incremented;
		});

		await t.test(
			'Agent default execution is denied; explicit settings and Provider CAS are authoritative',
			async () => {
				provider = expectStatus(
					await api('POST', '/api/v1/agent/ai/providers', {
						kind: 'openai-compatible',
						displayName: 'B10 provider',
						baseUrl: 'http://127.0.0.1:' + modelServer.address().port + '/v1',
						protocol: 'chat-completions',
						models: [{ id: 'fixture', contextWindow: 8192, maxOutputTokens: 256, supportsTools: false }],
						enabled: true,
						credential: 'b10-private-provider-key',
					}),
					201,
				);
				assert.equal(JSON.stringify(provider).includes('b10-private-provider-key'), false);
				assert.equal(
					expectStatus(
						await api('PATCH', '/api/v1/agent/ai/providers/' + provider.id, {
							expectedVersion: 999,
							enabled: false,
						}),
						409,
					).code,
					'version_conflict',
				);
				agentApp = expectStatus(await api('POST', '/api/v1/agent/apps', { name: 'B10 app' }), 201);
				thread = expectStatus(
					await api('POST', `/api/v1/agent/apps/${agentApp.id}/threads`, { title: 'B10 thread' }),
					201,
				);
				const runPath = `/api/v1/agent/apps/${agentApp.id}/threads/${thread.id}/runs`;
				const input = {
					prompt: 'hello',
					connectionIds: [],
					model: { providerId: provider.id, modelId: 'fixture', configurationVersion: provider.version },
				};
				assert.equal(
					expectStatus(await api('POST', runPath, input, { 'Idempotency-Key': randomUUID() }), 403).code,
					'execution_disabled',
				);
				assert.equal(calls.length, 0);
				const settings = expectStatus(await api('GET', '/api/v1/agent/execution-settings'), 200).settings;
				expectStatus(
					await api('PUT', '/api/v1/agent/execution-settings', {
						expectedVersion: settings.version,
						enabled: true,
						limits: settings.limits,
					}),
					200,
				);
			},
		);

		await t.test(
			'real streamed model output settles; replay preserves original result and does not redispatch',
			async () => {
				const path = `/api/v1/agent/apps/${agentApp.id}/threads/${thread.id}/runs`;
				const input = {
					prompt: 'complete once',
					connectionIds: [],
					model: { providerId: provider.id, modelId: 'fixture', configurationVersion: provider.version },
				};
				const headers = { 'Idempotency-Key': randomUUID() };
				const created = readAgentCreateRunResponse(expectStatus(await api('POST', path, input, headers), 201));
				const runPath = `/api/v1/agent/apps/${agentApp.id}/runs/${created.run.id}`;
				const completed = await until(
					async () => readAgentRunResponse(expectStatus(await api('GET', runPath), 200)),
					(run) => run.status === 'completed',
				);
				assert.ok(completed.version > created.run.version);
				assert.equal(calls.length, 1);
				assert.equal(calls[0].body.messages.at(-1).content, input.prompt);
				const replay = readAgentCreateRunResponse(expectStatus(await api('POST', path, input, headers), 200));
				assert.equal(replay.status, 'replayed');
				assert.deepEqual(replay.run, created.run);
				assert.equal(
					expectStatus(await api('POST', path, { ...input, prompt: 'changed' }, headers), 409).code,
					'idempotency_conflict',
				);
				assert.equal(calls.length, 1);
				const first = readAgentRunEventsResponse(
					expectStatus(await api('GET', runPath + '/events?after=0&limit=1'), 200),
				);
				const next = readAgentRunEventsResponse(
					expectStatus(await api('GET', runPath + `/events?after=${first.nextCursor}&limit=100`), 200),
				);
				assert.equal(first.items.length, 1);
				assert.ok(next.items.length > 0);
				assert.ok(next.items.every((event) => event.sequence > first.nextCursor));
			},
		);

		await t.test(
			'cancel rejects stale version, replays one intent and closes the real Provider stream',
			async () => {
				hold = true;
				const path = `/api/v1/agent/apps/${agentApp.id}/threads/${thread.id}/runs`;
				const input = {
					prompt: 'hold until cancellation',
					connectionIds: [],
					model: { providerId: provider.id, modelId: 'fixture', configurationVersion: provider.version },
				};
				const created = readAgentCreateRunResponse(
					expectStatus(await api('POST', path, input, { 'Idempotency-Key': randomUUID() }), 201),
				);
				await until(
					async () => calls.length,
					(count) => count === 2,
				);
				const runPath = `/api/v1/agent/apps/${agentApp.id}/runs/${created.run.id}`;
				const current = readAgentRunResponse(expectStatus(await api('GET', runPath), 200));
				assert.equal(
					expectStatus(
						await api(
							'POST',
							runPath + '/cancel',
							{ expectedVersion: 999 },
							{ 'Idempotency-Key': randomUUID() },
						),
						409,
					).code,
					'version_conflict',
				);
				const headers = { 'Idempotency-Key': randomUUID() };
				const cancelled = readAgentCancelRunResponse(
					expectStatus(
						await api('POST', runPath + '/cancel', { expectedVersion: current.version }, headers),
						200,
					),
				);
				assert.equal(cancelled.run.status, 'cancelled');
				const replay = readAgentCancelRunResponse(
					expectStatus(
						await api('POST', runPath + '/cancel', { expectedVersion: current.version }, headers),
						200,
					),
				);
				assert.equal(replay.status, 'replayed');
				assert.deepEqual(replay.run, cancelled.run);
				await until(async () => calls[1].closed, Boolean);
				assert.equal(calls.length, 2);
			},
		);

		await t.test(
			'encrypted backup imports through real maintenance and rebinds the existing HTTP listener',
			async () => {
				assert.equal(
					expectStatus(
						await api('POST', '/api/v1/settings/backup/export', { password: 'incorrect-password' }),
						401,
					).code,
					'invalid_password',
				);
				assert.deepEqual(expectStatus(await api('GET', '/api/v1/settings/logging'), 200), {
					version: 0,
					level: 'info',
					effectiveLevel: 'info',
					updatedAt: 0,
				});
				const exported = await api('POST', '/api/v1/settings/backup/export', { password });
				expectStatus(exported, 200);
				assert.equal(exported.bytes.subarray(0, 9).toString('ascii'), 'NXSEALED2');
				expectStatus(
					await api('POST', '/api/v1/quick-commands', {
						name: 'after snapshot',
						command: 'pwd',
						variables: {},
						tagIds: [],
					}),
					201,
				);
				const boundary = 'b10-' + randomUUID();
				const multipart = Buffer.concat([
					Buffer.from(
						'--' +
							boundary +
							'\r\nContent-Disposition: form-data; name="backupFile"; filename="b10.nexus-backup"\r\nContent-Type: application/octet-stream\r\n\r\n',
					),
					exported.bytes,
					Buffer.from('\r\n--' + boundary + '--\r\n'),
				]);
				const corrupted = Buffer.from(multipart);
				const payloadOffset = multipart.indexOf(exported.bytes);
				assert.ok(payloadOffset > 0);
				corrupted[payloadOffset + exported.bytes.length - 1] ^= 1;
				assert.equal(
					expectStatus(
						await api('POST', '/api/v1/settings/backup/import', corrupted, {
							'Content-Type': 'multipart/form-data; boundary=' + boundary,
						}),
						401,
					).code,
					'invalid_password',
				);
				assert.equal(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries.length, 2);
				const restored = expectStatus(
					await api('POST', '/api/v1/settings/backup/import', multipart, {
						'Content-Type': 'multipart/form-data; boundary=' + boundary,
					}),
					200,
				);
				assert.equal(restored.restoredTables, 87);
				assert.ok(restored.restoredRows > 0);
				assert.equal(typeof restored.cleanupPending, 'boolean');
				assert.deepEqual(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries, [command]);
				assert.equal(expectStatus(await api('GET', '/api/v1/auth/status'), 200).isAuthenticated, true);
				assert.equal(calls.length, 2);
			},
		);

		await t.test(
			'restart preserves personal state/settings and does not replay historical paid requests',
			async () => {
				await app.close();
				app = await createApp(dbPath, { encryptionKey: key });
				address = await app.listenHttp({ publicOrigin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });
				assert.deepEqual(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries, [command]);
				assert.equal(
					expectStatus(await api('GET', '/api/v1/agent/execution-settings'), 200).settings.enabled,
					true,
				);
				expectStatus(await api('POST', '/api/v1/auth/logout'), 200);
				expectStatus(await api('GET', '/api/v1/auth/status'), 401);
				expectStatus(await api('GET', '/api/v1/quick-commands'), 401);
				expectStatus(await api('GET', '/api/v1/agent/ai/providers'), 401);
				assert.equal(calls.length, 2);
			},
		);
	} finally {
		modelServer.closeAllConnections();
		await new Promise((resolve) => modelServer.close(resolve));
		if (app) {
			await app.close();
		}
		await rm(directory, { recursive: true, force: true });
	}
});
