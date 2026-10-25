import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '../../../packages/shared/dist/agent/scope/values.js';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { origin, until, send, expectStatus } from '../remote/openssh-fixture.mjs';

export const IMAGE_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
	'base64',
);

/** Only the external provider is scripted; HTTP, governance, Run and files stay real. */
export async function openImageFixture(directory, { publicOrigin = origin, png = IMAGE_PNG } = {}) {
	const calls = [];
	const failures = [];
	const pending = new Set();
	const held = new Set();
	let imageMode = 'normal';
	let provider;
	const model = createServer((request, response) => {
		const task = (async () => {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			calls.push({ path: request.url, body });
			if (request.url === '/v1/images/generations') {
				assert.equal(body.n, 1);
				if (imageMode === 'hold') {
					held.add(response);
					response.once('close', () => held.delete(response));
					return;
				}
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end(
					JSON.stringify({
						data: [
							imageMode === 'url'
								? { url: 'http://127.0.0.1/private' }
								: { b64_json: png.toString('base64') },
						],
					}),
				);
				return;
			}
			assert.equal(request.url, '/v1/chat/completions');
			const results = body.messages
				.filter((message) => message.role === 'tool')
				.map((message) => JSON.parse(message.content));
			let action;
			if (results.length === 0) action = { name: 'image_models_list', input: {} };
			else if (results.length === 1) {
				const selected = results[0].models.find((item) => item.modelId === 'gpt-image-2.5');
				assert.ok(selected);
				action = { name: 'image_generate', input: { ...selected, prompt: 'A blue circle.' } };
			}
			const result = results.at(-1);
			const delta = action
				? {
						tool_calls: [
							{
								index: 0,
								id: 'call_' + results.length,
								type: 'function',
								function: { name: action.name, arguments: JSON.stringify(action.input) },
							},
						],
					}
				: {
						content:
							'![Generated image](' +
							result.previewUrl +
							')\n\n[Download image](' +
							result.downloadUrl +
							')',
					};
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.end(
				'data: ' +
					JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] }) +
					'\n\ndata: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }],
						usage: { prompt_tokens: 100, completion_tokens: 32 },
					}) +
					'\n\ndata: [DONE]\n\n',
			);
		})();
		pending.add(task);
		void task.then(
			() => pending.delete(task),
			(error) => {
				pending.delete(task);
				failures.push(error);
				response.destroy(error);
			},
		);
	});
	model.listen(0, '127.0.0.1');
	await once(model, 'listening');
	let app;
	let cookie = '';
	let address;

	const api = (method, path, input, headers = {}) =>
		send(address, cookie, method, path, input, {
			Host: new URL(publicOrigin).host,
			Origin: publicOrigin,
			...headers,
		});

	const close = async () => {
		try {
			await app?.close();
		} finally {
			for (const response of held) response.destroy();
			model.closeAllConnections();
			await new Promise((resolve) => model.close(resolve));
			await Promise.allSettled([...pending]);
			assert.deepEqual(failures, []);
		}
	};

	try {
		app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
		address = await app.listenHttp({ publicOrigin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });
		const password = 'isolated-image-acceptance-password-123';
		expectStatus(
			await api('POST', '/api/v1/auth/setup', { username: 'admin', password, confirmPassword: password }),
			201,
		);
		const login = await api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });
		expectStatus(login, 200);
		cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
		provider = expectStatus(
			await api('POST', '/api/v1/agent/ai/providers', {
				kind: 'openai-compatible',
				displayName: 'Image acceptance',
				baseUrl: 'http://127.0.0.1:' + model.address().port + '/v1',
				protocol: 'chat-completions',
				models: [
					{ id: 'text-model', contextWindow: 131072, maxOutputTokens: 256, supportsTools: true },
					{ id: 'gpt-image-2.5', protocol: 'images', supportsTools: false, supportsImageGeneration: true },
				],
				enabled: true,
				credential: 'isolated-fixture-secret',
			}),
			201,
		);
		const agentApp = expectStatus(await api('POST', '/api/v1/agent/apps', { name: 'Image acceptance' }), 201);
		const base = '/api/v1/agent/apps/' + agentApp.id;

		const grants = async (capabilities) => {
			const current = expectStatus(await api('GET', base + '/grants'), 200);
			return expectStatus(
				await api('PUT', base + '/grants', {
					expectedPolicyRevision: current.policyRevision,
					grants: capabilities.map((capability) => ({ capability, scope: { kind: 'global' } })),
				}),
				200,
			);
		};

		await grants(['context.read', 'artifacts.read', 'artifacts.write']);
		const settings = expectStatus(await api('GET', '/api/v1/agent/execution-settings'), 200).settings;
		expectStatus(
			await api('PUT', '/api/v1/agent/execution-settings', {
				expectedVersion: settings.version,
				enabled: true,
				limits: settings.limits,
			}),
			200,
		);
		return {
			api,
			base,
			appId: agentApp.id,
			appVersion: agentApp.version,
			provider,
			calls,
			png,
			close,
			grants,

			get address() {
				return address;
			},

			get cookie() {
				return cookie;
			},

			setImageMode(mode) {
				imageMode = mode;
			},

			async start(modelId = 'gpt-image-2.5', prompt = 'A blue circle.') {
				const thread = expectStatus(
					await api('POST', base + '/threads', { title: modelId + ' acceptance' }),
					201,
				);
				const run = expectStatus(
					await api(
						'POST',
						base + '/threads/' + thread.id + '/runs',
						{
							prompt,
							connectionIds: [],
							model: { providerId: provider.id, modelId, configurationVersion: provider.version },
						},
						{ 'Idempotency-Key': randomUUID() },
					),
					201,
				).run;
				return { thread, run };
			},

			wait(run, status) {
				return until(
					async () => expectStatus(await api('GET', base + '/runs/' + run.id), 200),
					(value) => value.status === status,
					'Image Run ' + status,
				);
			},

			async entries(thread) {
				return expectStatus(
					await api('POST', base + '/workspace', {
						appVersion: agentApp.version,
						request: {
							method: 'agent.threads.entries',
							params: {
								threadId: thread.id,
								after: { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 },
								limit: AGENT_THREAD_ENTRY_MAX_PAGE,
							},
						},
					}),
					200,
				).result.value;
			},

			approval(run) {
				return until(
					async () =>
						expectStatus(
							await api('GET', '/api/v1/apps/' + agentApp.id + '/runs/' + run.id + '/approvals'),
							200,
						),
					(items) => items.some((item) => item.status === 'requested'),
					'Image approval',
				).then((items) => items.find((item) => item.status === 'requested'));
			},

			approve(approval) {
				return api(
					'POST',
					'/api/v1/apps/' + agentApp.id + '/approvals/' + approval.id + '/resolve',
					{ decision: 'approved', operationHash: approval.operationHash, expectedVersion: approval.version },
					{ 'Idempotency-Key': randomUUID() },
				).then((response) => expectStatus(response, 200));
			},
		};
	} catch (error) {
		try {
			await close();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Image fixture startup and cleanup failed');
		}
		throw error;
	}
}
