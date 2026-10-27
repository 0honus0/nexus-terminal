import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { origin, until, send, expectStatus, openSshd } from '../remote/openssh-fixture.mjs';
import { toolDefinitions } from '../../../packages/backend/dist/modules/agent/tools/service/tool-definitions.js';
import { validateContextBudget } from '../../../packages/backend/dist/modules/agent/context/context-rules.js';
import { RunModelStream } from '../../../packages/backend/dist/modules/agent/runs/model/run-model-stream.js';
import { chatModelRequest } from '../../../packages/backend/dist/platform/ai/adapters/model-request.js';
import {
	ModelNetworkFailure,
	MODEL_TOOL_MAX_DEFINITIONS,
} from '../../../packages/backend/dist/platform/ai/model-port.js';

await test('B10 tool catalog and conversation budgets preserve their independent boundaries', async () => {
	const definitions = toolDefinitions();
	const reservedOutputTokens = 256;
	const contextWindow = 131072;
	validateContextBudget([{ role: 'user', content: 'hello' }], definitions, { contextWindow, reservedOutputTokens });
	// Local byte estimates must not reject a valid provider window or shrink it to 32K.
	validateContextBudget([{ role: 'user', content: 'x'.repeat(33000) }], definitions, {
		contextWindow,
		reservedOutputTokens,
	});
	validateContextBudget([{ role: 'user', content: 'hello' }], definitions, {
		contextWindow: 8192,
		reservedOutputTokens,
	});

	// Capture the actual Model conversion, then exercise the real technical request encoder.
	let input;
	const network = {
		async *stream(value) {
			input = value;
			yield { type: 'text_delta', text: 'ok' };
			yield { type: 'completed', finishReason: 'stop' };
		},
	};
	const stream = new RunModelStream(network);
	for await (const event of stream.stream(
		{
			executionPolicy: 'governed',
			baseUrl: 'http://127.0.0.1/v1',
			protocol: 'chat-completions',
			modelId: 'fixture',
			capabilities: { maxOutputTokens: reservedOutputTokens },
		},
		[{ role: 'user', content: 'hello' }],
		definitions,
		null,
		new AbortController().signal,
	)) {
		assert.ok(['text', 'finished'].includes(event.kind));
	}
	assert.ok(chatModelRequest(input).tools.length > 32);
	const definition = input.tools[0];
	const catalog = Array.from({ length: MODEL_TOOL_MAX_DEFINITIONS }, (_, index) => ({
		...definition,
		name: 'tool_' + index,
	}));
	assert.equal(chatModelRequest({ ...input, tools: catalog }).tools.length, MODEL_TOOL_MAX_DEFINITIONS);
	assert.throws(
		() => chatModelRequest({ ...input, tools: [...catalog, { ...definition, name: 'overflow' }] }),
		(error) => error instanceof ModelNetworkFailure && error.kind === 'response_invalid',
	);
	assert.throws(
		() =>
			chatModelRequest({
				...input,
				messages: [
					{ role: 'user', content: 'hello' },
					{
						role: 'assistant',
						content: '',
						reasoning: [],
						toolCalls: Array.from({ length: 33 }, (_, index) => ({
							id: 'call_' + index,
							name: definition.name,
							argumentsJson: '{}',
						})),
					},
				],
			}),
		(error) => error instanceof ModelNetworkFailure && error.kind === 'response_invalid',
	);
});

await test('B10 Agent tool approval, actual SSH effects and revocation', { timeout: 60000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-agent-tools-'));
	const calls = [];
	let app;
	let sshd;
	let address;
	let cookie = '';
	let provider;
	let agentApp;
	let connectionId;
	const modelServer = createServer(async (req, response) => {
		const chunks = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		calls.push(body);
		const scenario = JSON.parse(body.messages.findLast((message) => message.role === 'user').content);
		const hasResult = body.messages.some((message) => message.role === 'tool');
		const delta = hasResult
			? { content: 'Tool result received' }
			: {
					tool_calls: [
						{
							index: 0,
							id: 'fixture-call',
							type: 'function',
							function: {
								name: 'file_write',
								arguments: JSON.stringify({
									connectionId,
									path: scenario.path,
									content: scenario.content,
									expectedSha256: 'absent',
								}),
							},
						},
					],
				};
		response.writeHead(200, { 'Content-Type': 'text/event-stream' });
		response.end(
			'data: ' +
				JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] }) +
				'\n\ndata: ' +
				JSON.stringify({
					choices: [{ index: 0, delta: {}, finish_reason: hasResult ? 'stop' : 'tool_calls' }],
					usage: { prompt_tokens: 100, completion_tokens: 30 },
				}) +
				'\n\ndata: [DONE]\n\n',
		);
	});

	const api = (method, path, input, headers) => send(address, cookie, method, path, input, headers);

	const base = () => '/api/v1/agent/apps/' + agentApp.id;

	const approvalPath = (approval) => '/api/v1/apps/' + agentApp.id + '/approvals/' + approval.id;

	const runPath = (run) => base() + '/runs/' + run.id;

	const approvals = async (run) => await listAgentApprovalHistory(api, agentApp.id, run.id);

	const tool = async (run, approval) => {
		const page = expectStatus(await api('GET', base() + '/threads/' + run.threadId + '/tools?limit=100'), 200);
		const found = page.items.find((item) => item.id === approval.toolCallId);
		assert.ok(found);
		return found;
	};

	const waitRun = (run, status) =>
		until(
			async () => expectStatus(await api('GET', runPath(run)), 200),
			(value) => value.status === status,
			'Agent Run ' + status,
		);

	const absent = async (path) => assert.rejects(stat(path), { code: 'ENOENT' });

	async function grants(enabled) {
		const current = expectStatus(await api('GET', base() + '/grants'), 200);
		return expectStatus(
			await api('PUT', base() + '/grants', {
				expectedPolicyRevision: current.policyRevision,
				grants: enabled
					? [
							{
								capability: 'file.write',
								scope: {
									kind: 'targets',
									targets: { ssh: { mode: 'ids', ids: [String(connectionId)] } },
								},
							},
						]
					: [],
			}),
			200,
		);
	}

	async function start(name) {
		const thread = expectStatus(await api('POST', base() + '/threads', { title: name }), 201);
		const path = join(directory, name + '.txt');
		const input = {
			prompt: JSON.stringify({ path, content: 'private-content-' + name }),
			approvalMode: 'ask',
			connectionIds: [connectionId],
			model: { providerId: provider.id, modelId: 'fixture', configurationVersion: provider.version },
		};
		const run = expectStatus(
			await api('POST', base() + '/threads/' + thread.id + '/runs', input, { 'Idempotency-Key': randomUUID() }),
			201,
		).run;
		const pending = await until(
			async () => {
				const current = expectStatus(await api('GET', runPath(run)), 200);
				assert.ok(
					!['failed', 'unknown', 'cancelled'].includes(current.status),
					JSON.stringify({ current, modelCalls: calls.length }),
				);
				return approvals(run);
			},
			(items) => items.some((entry) => entry.status === 'requested'),
			'Tool approval produced',
		);
		assert.equal(pending.length, 1);
		const approval = pending[0];
		assert.equal(approval.inspection.toolName, 'file_write');
		assert.equal(approval.inspection.targetConnectionId, connectionId);
		assert.equal(JSON.stringify(approval).includes('private-content-'), false);
		assert.equal((await tool(run, approval)).state, 'inspected');
		await absent(path);
		return { run, approval, path, content: 'private-content-' + name };
	}

	function resolve(approval, decision, key = randomUUID()) {
		return api(
			'POST',
			approvalPath(approval) + '/resolve',
			{ decision, operationHash: approval.operationHash, expectedVersion: approval.version },
			{ 'Idempotency-Key': key },
		);
	}

	try {
		sshd = await openSshd(directory);
		modelServer.listen(0, '127.0.0.1');
		await once(modelServer, 'listening');
		app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
		address = await app.listenHttp({ publicOrigin: origin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });
		const password = 'b10-tools-password-123';
		expectStatus(
			await api('POST', '/api/v1/auth/setup', { username: 'admin', password, confirmPassword: password }),
			201,
		);
		const login = await api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });
		expectStatus(login, 200);
		cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
		await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: sshd.port, fingerprint: sshd.fingerprint });
		const key = await app.targets.sshKeys.create({ name: 'fixture', privateKey: sshd.privateKey });
		const target = await app.targets.create({
			name: 'fixture',
			type: 'SSH',
			host: '127.0.0.1',
			port: sshd.port,
			username: sshd.user,
			route: 'direct',
			proxyId: null,
			tagIds: [],
			jumpIds: [],
			notes: null,
		});
		connectionId = target.id;
		assert.equal(
			(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: key.id }))
				.status,
			'updated',
		);
		provider = expectStatus(
			await api('POST', '/api/v1/agent/ai/providers', {
				kind: 'openai-compatible',
				displayName: 'tools fixture',
				baseUrl: 'http://127.0.0.1:' + modelServer.address().port + '/v1',
				protocol: 'chat-completions',
				models: [{ id: 'fixture', contextWindow: 131072, maxOutputTokens: 256, supportsTools: true }],
				enabled: true,
				credential: 'isolated-provider-secret',
			}),
			201,
		);
		agentApp = expectStatus(await api('POST', '/api/v1/agent/apps', { name: 'Tools fixture' }), 201);
		await grants(true);
		const settings = expectStatus(await api('GET', '/api/v1/agent/execution-settings'), 200).settings;
		expectStatus(
			await api('PUT', '/api/v1/agent/execution-settings', {
				expectedVersion: settings.version,
				enabled: true,
				limits: settings.limits,
			}),
			200,
		);

		await t.test(
			'concurrent identical approval resolution consumes once and completes an actual SSH write',
			async () => {
				const { run, approval, path, content } = await start('approved');
				const bad = await api(
					'POST',
					approvalPath(approval) + '/resolve',
					{ decision: 'approved', operationHash: '0'.repeat(64), expectedVersion: approval.version },
					{ 'Idempotency-Key': randomUUID() },
				);
				expectStatus(bad, 409);
				const key = randomUUID();
				for (const response of await Promise.all([
					resolve(approval, 'approved', key),
					resolve(approval, 'approved', key),
				])) {
					assert.equal(expectStatus(response, 200).status, 'approved');
				}
				await waitRun(run, 'completed');
				assert.equal(await readFile(path, 'utf8'), content);
				assert.equal((await stat(path)).mode & 0o777, 0o600);
				const settled = expectStatus(await api('GET', approvalPath(approval)), 200);
				assert.ok(settled.consumedAt !== null);
				assert.equal((await tool(run, approval)).state, 'completed');
				for (const path of [
					'/steps/1',
					'/steps/1/events?after=0&limit=50',
					'/tools/' + approval.toolCallId,
					'/tools/' + approval.toolCallId + '/events?after=0&limit=50',
				]) {
					expectStatus(await api('GET', runPath(run) + path), 404);
				}
				assert.equal(expectStatus(await resolve(approval, 'approved', key), 200).status, 'approved');
				assert.equal(calls.length, 2);
				assert.ok(calls[1].messages.some((message) => message.role === 'tool'));
				assert.equal(await readFile(path, 'utf8'), content);
			},
		);

		await t.test('denial creates no file or dispatch and ends the Run without another model request', async () => {
			const { run, approval, path } = await start('denied');
			assert.equal(expectStatus(await resolve(approval, 'denied'), 200).status, 'denied');
			await waitRun(run, 'failed');
			await absent(path);
			assert.equal((await tool(run, approval)).state, 'failed');
			assert.equal(expectStatus(await api('GET', approvalPath(approval)), 200).consumedAt, null);
			assert.equal(calls.length, 3);
		});

		await t.test('Run cancellation invalidates a pending approval without dispatch', async () => {
			const { run, approval, path } = await start('cancelled');
			const current = expectStatus(await api('GET', runPath(run)), 200);
			expectStatus(
				await api(
					'POST',
					runPath(run) + '/cancel',
					{ expectedVersion: current.version },
					{ 'Idempotency-Key': randomUUID() },
				),
				200,
			);
			await waitRun(run, 'cancelled');
			assert.equal(expectStatus(await api('GET', approvalPath(approval)), 200).status, 'superseded');
			expectStatus(await resolve(approval, 'approved'), 409);
			assert.equal((await tool(run, approval)).state, 'cancelled');
			await absent(path);
			assert.equal(calls.length, 4);
		});

		await t.test('grant revocation supersedes approval; restoring permission cannot revive it', async () => {
			const { run, approval, path } = await start('revoked');
			await grants(false);
			await until(
				async () => tool(run, approval),
				(value) => value.state === 'failed',
				'Revoked tool settles',
			);
			assert.equal(expectStatus(await api('GET', approvalPath(approval)), 200).status, 'superseded');
			expectStatus(await resolve(approval, 'approved'), 409);
			await grants(true);
			expectStatus(await resolve(approval, 'approved'), 409);
			await absent(path);
		});

		await t.test(
			'denylisting a target fences the pending Run and cannot be undone by an old approval',
			async () => {
				const { run, approval, path } = await start('denylisted');
				const denylist = expectStatus(await api('GET', '/api/v1/agent/target-denylist'), 200);
				expectStatus(
					await api('PUT', '/api/v1/agent/target-denylist', {
						expectedRevision: denylist.revision,
						connectionIds: [connectionId],
						reason: 'isolated regression',
					}),
					200,
				);
				await waitRun(run, 'cancelled');
				assert.equal((await tool(run, approval)).state, 'cancelled');
				assert.equal(expectStatus(await api('GET', approvalPath(approval)), 200).consumedAt, null);
				expectStatus(await resolve(approval, 'approved'), 409);
				await absent(path);
			},
		);
	} finally {
		try {
			if (app) {
				await app.close();
			}
		} finally {
			modelServer.closeAllConnections();
			await new Promise((resolve) => modelServer.close(resolve));
			if (sshd) {
				await sshd.close();
			}
			await rm(directory, { recursive: true, force: true });
		}
	}
});
