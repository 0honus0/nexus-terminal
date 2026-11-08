import { fixtureToolName, hasToolIdentity, hasApprovalIdentity } from '../../support/package-tool-catalog.mjs';
import { createTestAgentApp } from './native-agent-fixture.mjs';
import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { ToolExecutionUnknown } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { origin, until, send, expectStatus, openWorkspace } from '../remote/openssh-fixture.mjs';
import { AGENT_TARGET_CAPABILITIES } from '../../../packages/shared/dist/agent/governance/values.js';

export function hasUnknown(error) {
	return (
		error instanceof ToolExecutionUnknown ||
		(error instanceof AggregateError && error.errors.some(hasUnknown)) ||
		(error instanceof Error && error.cause !== undefined && hasUnknown(error.cause))
	);
}

/** Explicitly exercise the real App's lazy discovery before the scenario's domain calls. */
export function discoverTools(query, program) {
	return (results, body) => {
		if (results.length === 0) {
			return { name: 'tool_search', input: { query } };
		}
		assert.ok(Array.isArray(results[0].loadKeys), 'Discovery must return exact callable keys');
		assert.ok(results[0].loadKeys.length > 0, 'The selected and authorized tools must be discoverable');
		return program(results.slice(1), body);
	};
}

/** Only Provider output is scripted; execution, authorization and persistence stay real. */
export async function openAgentExecution(directory, sshd, options = {}) {
	const database = join(directory, 'state.db');
	const encryptionKey = randomBytes(32);
	const programs = new Map();
	const calls = [];
	const pending = new Set();
	const held = new Set();
	const fixtureFailures = [];
	let app;
	let address;
	let cookie = '';
	let provider;
	let agentApp;
	let connectionId;
	const model = createServer((request, response) => {
		const task = Promise.resolve().then(async () => {
			const chunks = [];
			for await (const chunk of request) {
				chunks.push(chunk);
			}
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			const messages = body.messages ?? body.input;
			const key = messages.findLast((message) => message.role === 'user').content;
			const program = programs.get(key);
			assert.ok(program, 'Unknown fixture program');
			const results = messages
				.filter((message) => message.role === 'tool' || message.type === 'function_call_output')
				.map((message) => JSON.parse(message.content ?? message.output));
			calls.push({ key, body, authorization: request.headers.authorization });
			const action = await program(results, body);
			if (action.status) {
				response.writeHead(action.status, {
					'Content-Type': 'application/json',
					'Retry-After': '0.01',
					'x-should-retry': 'true',
				});
				response.end(JSON.stringify({ error: { message: 'Controlled provider refusal', code: action.code } }));
				return;
			}
			if (action.disconnect) {
				response.destroy();
				return;
			}
			const batch = action.calls ?? (action.name ? [{ name: action.name, input: action.input }] : []);
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.flushHeaders();
			if (body.input) {
				assert.ok(!action.hold);
				if (batch.length) {
					const output = batch.map((call, index) => ({
						type: 'function_call',
						id: 'fc_' + (results.length + index),
						call_id: 'call_' + (results.length + index),
						name: fixtureToolName(body, call.name),
						arguments: JSON.stringify(call.input),
						status: 'completed',
					}));
					response.write(
						'data: ' +
							JSON.stringify({
								type: 'response.created',
								response: { id: 'resp_flow', created_at: 1700000000, model: body.model },
							}) +
							'\n\n',
					);
					for (const [index, item] of output.entries()) {
						for (const event of [
							{
								type: 'response.output_item.added',
								output_index: index,
								item: { ...item, arguments: '', status: 'in_progress' },
							},
							{
								type: 'response.function_call_arguments.delta',
								item_id: item.id,
								output_index: index,
								delta: item.arguments,
							},
							{
								type: 'response.function_call_arguments.done',
								item_id: item.id,
								output_index: index,
								arguments: item.arguments,
							},
							{ type: 'response.output_item.done', output_index: index, item },
						])
							response.write('data: ' + JSON.stringify(event) + '\n\n');
					}
					response.end(
						'data: ' +
							JSON.stringify({
								type: 'response.completed',
								response: {
									status: 'completed',
									output,
									usage: { input_tokens: 100, output_tokens: 32 },
								},
							}) +
							'\n\n',
					);
					return;
				}
				const text = action.text ?? 'Fixture finished';
				const item = {
					type: 'message',
					id: 'msg_flow',
					role: 'assistant',
					content: [{ type: 'output_text', text }],
				};
				for (const event of [
					{
						type: 'response.created',
						response: { id: 'resp_flow', created_at: 1700000000, model: body.model },
					},
					{
						type: 'response.output_item.added',
						output_index: 0,
						item: { type: 'message', id: item.id, role: 'assistant', content: [] },
					},
					{
						type: 'response.output_text.delta',
						item_id: 'msg_flow',
						output_index: 0,
						delta: text,
					},
					{ type: 'response.output_text.done', item_id: item.id, output_index: 0, text },
					{ type: 'response.output_item.done', output_index: 0, item },
					{
						type: 'response.completed',
						response: {
							status: 'completed',
							output: [item],
							usage: { input_tokens: 100, output_tokens: 32 },
						},
					},
				]) {
					response.write('data: ' + JSON.stringify(event) + '\n\n');
				}
				response.end();
				return;
			}
			for (const text of action.chunks ?? []) {
				response.write(
					'data: ' +
						JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) +
						'\n\n',
				);
			}
			if (action.hold) {
				held.add(response);
				response.once('close', () => held.delete(response));
				return;
			}
			const delta = batch.length
				? {
						tool_calls: batch.map((call, index) => ({
							index,
							id: 'call_' + (results.length + index),
							type: 'function',
							function: { name: fixtureToolName(body, call.name), arguments: JSON.stringify(call.input) },
						})),
					}
				: { content: action.text ?? 'Fixture finished' };
			response.end(
				'data: ' +
					JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] }) +
					'\n\ndata: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: {}, finish_reason: batch.length ? 'tool_calls' : 'stop' }],
						usage: { prompt_tokens: 100, completion_tokens: 32 },
					}) +
					'\n\ndata: [DONE]\n\n',
			);
		});
		pending.add(task);
		void task.then(
			() => pending.delete(task),
			(error) => {
				pending.delete(task);
				fixtureFailures.push(error);
				response.destroy(error);
			},
		);
	});

	const api = (method, path, input, headers) => send(address, cookie, method, path, input, headers);

	const base = () => '/api/v1/agent/apps/' + agentApp.id;

	const runPath = (run) => base() + '/runs/' + run.id;

	const approvalPath = (approval) => '/api/v1/apps/' + agentApp.id + '/approvals/' + approval.id;

	async function boot() {
		app = await createApp(database, { encryptionKey });
		address = await app.listenHttp({ publicOrigin: origin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });
	}

	async function grants(capabilities) {
		const current = expectStatus(await api('GET', base() + '/grants'), 200);
		return expectStatus(
			await api('PUT', base() + '/grants', {
				expectedPolicyRevision: current.policyRevision,
				grants: (capabilities.length ? [...new Set(['plugin.invoke', ...capabilities])] : []).map(
					(capability) => ({
						capability,
						scope: AGENT_TARGET_CAPABILITIES.includes(capability)
							? { kind: 'targets', targets: { ssh: { mode: 'ids', ids: [String(connectionId)] } } }
							: { kind: 'global' },
					}),
				),
			}),
			200,
		);
	}

	async function close({ unknown = false } = {}) {
		try {
			if (app) {
				if (unknown) {
					await assert.rejects(app.close(), hasUnknown);
				} else {
					await app.close();
				}
				app = null;
			}
		} catch (error) {
			const describe = (value) =>
				value instanceof Error
					? {
							name: value.name,
							code: value.code,
							frames: value.stack?.split('\n').slice(1, 4),
							cause: value.cause ? describe(value.cause) : null,
							errors: value instanceof AggregateError ? value.errors.map(describe) : [],
						}
					: { type: typeof value };

			console.error('Agent fixture close evidence', JSON.stringify(describe(error)));
			throw error;
		} finally {
			model.closeAllConnections();
			await new Promise((resolve) => model.close(resolve));
			await Promise.allSettled([...pending]);
			assert.deepEqual(fixtureFailures, []);
		}
	}

	try {
		model.listen(0, '127.0.0.1');
		await once(model, 'listening');
		await boot();
		const password = 'isolated-agent-b10-password-123';
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
				displayName: 'B10 execution',
				baseUrl: 'http://127.0.0.1:' + model.address().port + '/v1',
				protocol: options.protocol ?? 'chat-completions',
				models: [
					{
						id: 'fixture',
						contextWindow: options.contextWindow ?? 131072,
						maxOutputTokens: 256,
						supportsTools: true,
					},
				],
				enabled: true,
				credential: 'isolated-secret',
			}),
			201,
		);
		agentApp = await createTestAgentApp(api, directory, 'Execution fixture', options.plugin);
		await grants([
			'file.read',
			'file.write',
			'file.delete',
			'shell.execute',
			'machine.inspect',
			'context.read',
			'context.compact',
			'artifacts.read',
			'artifacts.write',
		]);
		const settings = expectStatus(await api('GET', '/api/v1/agent/execution-settings'), 200).settings;
		expectStatus(
			await api('PUT', '/api/v1/agent/execution-settings', {
				expectedVersion: settings.version,
				enabled: true,
				limits: settings.limits,
			}),
			200,
		);
	} catch (error) {
		try {
			await close();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Fixture startup and close failed');
		}
		throw error;
	}

	return {
		api,
		appId: agentApp.id,
		calls,
		connectionId,
		database,
		close,

		get heldModelCount() {
			return held.size;
		},

		openWorkspace() {
			return openWorkspace(address, cookie);
		},

		openRunStream() {
			return new WebSocket('ws://' + address + '/ws/agent-runs', {
				origin,
				headers: { Host: new URL(origin).host, Cookie: cookie },
			});
		},

		program(name, program) {
			const key = name + ':' + randomUUID();
			programs.set(key, options.discover ? discoverTools(options.discover, program) : program);
			return key;
		},

		finishModels() {
			for (const response of held) {
				response.end(
					'data: ' +
						JSON.stringify({
							choices: [{ index: 0, delta: { content: 'Fixture released' }, finish_reason: null }],
						}) +
						'\n\ndata: ' +
						JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
						'\n\ndata: [DONE]\n\n',
				);
			}
		},

		failModels() {
			for (const response of held) {
				response.destroy();
			}
		},

		async start(name, program, { connectionIds = [connectionId] } = {}) {
			const key = name + ':' + randomUUID();
			programs.set(key, options.discover ? discoverTools(options.discover, program) : program);
			const thread = expectStatus(await api('POST', base() + '/threads', { title: name }), 201);
			return expectStatus(
				await api(
					'POST',
					base() + '/threads/' + thread.id + '/runs',
					{
						prompt: key,
						approvalMode: 'ask',
						connectionIds,
						inputJson: JSON.stringify({
							model: {
								providerId: provider.id,
								modelId: 'fixture',
								configurationVersion: provider.version,
								reasoningEffort: null,
							},
							artifacts: [],
						}),
					},
					{ 'Idempotency-Key': randomUUID() },
				),
				201,
			).run;
		},

		async wait(run, status, timeoutMs = 10000) {
			const settled = await until(
				async () => expectStatus(await api('GET', runPath(run)), 200),
				(value) =>
					value.status === status || ['completed', 'failed', 'cancelled', 'unknown'].includes(value.status),
				'Run ' + status,
				timeoutMs,
			);
			if (settled.status !== status && fixtureFailures.length) {
				throw new AggregateError(
					[...fixtureFailures],
					'Provider fixture failed: ' +
						JSON.stringify(settled) +
						'\n' +
						fixtureFailures.map((failure) => failure.stack ?? String(failure)).join('\n'),
				);
			}
			assert.equal(settled.status, status, JSON.stringify(settled));
			return settled;
		},

		async approval(run, name) {
			const matches = (value) => {
				return hasApprovalIdentity(value, name);
			};

			const items = await until(
				async () => await listAgentApprovalHistory(api, agentApp.id, run.id),
				(values) => values.some((value) => value.status === 'requested' && matches(value)),
				'Approval ' + name,
			);
			return items.find((value) => value.status === 'requested' && matches(value));
		},

		approve(approval) {
			return api(
				'POST',
				approvalPath(approval) + '/resolve',
				{ decision: 'approved', operationHash: approval.operationHash, expectedVersion: approval.version },
				{ 'Idempotency-Key': randomUUID() },
			).then((response) => expectStatus(response, 200));
		},

		async cancel(run) {
			const current = expectStatus(await api('GET', runPath(run)), 200);
			return expectStatus(
				await api(
					'POST',
					runPath(run) + '/cancel',
					{ expectedVersion: current.version },
					{ 'Idempotency-Key': randomUUID() },
				),
				200,
			);
		},

		grants,

		operations(run) {
			const db = new DatabaseSync(database, { readOnly: true });
			try {
				return db.prepare('SELECT * FROM agent_operations WHERE run_id=? ORDER BY sequence').all(run.id);
			} finally {
				db.close();
			}
		},

		modelInvocations(run) {
			return this.operations(run)
				.filter((row) => row.kind === 'model')
				.map((row) => {
					const input = JSON.parse(row.arguments_json);
					assert.equal(createHash('sha256').update(row.arguments_json).digest('hex'), row.request_hash);
					return { operation: row, input, messages: JSON.parse(this.content(input.messages)) };
				});
		},

		messageChunks(run) {
			const db = new DatabaseSync(database, { readOnly: true });
			try {
				const messages = db
					.prepare('SELECT * FROM agent_app_messages WHERE run_id=? ORDER BY ordinal')
					.all(run.id);
				return messages.flatMap((message) => {
					const chunks = db
						.prepare('SELECT * FROM agent_app_message_chunks WHERE message_id=? ORDER BY chunk_index')
						.all(message.id);
					assert.equal(chunks.length, message.chunks);
					return chunks.map((chunk, index) => {
						assert.equal(chunk.chunk_index, index);
						assert.equal(createHash('sha256').update(chunk.text).digest('hex'), chunk.sha256);
						return { message, chunk };
					});
				});
			} finally {
				db.close();
			}
		},

		content(reference) {
			const db = new DatabaseSync(database, { readOnly: true });
			try {
				const record = db.prepare('SELECT * FROM agent_operation_contents WHERE id=?').get(reference.id);
				assert.equal(record.sealed, 1);
				assert.equal(record.sha256, reference.sha256);
				assert.equal(record.size_bytes, reference.sizeBytes);
				const chunks = db
					.prepare('SELECT * FROM agent_operation_content_chunks WHERE content_id=? ORDER BY chunk_index')
					.all(reference.id);
				assert.equal(chunks.length, record.chunks);
				const text = chunks
					.map((chunk, index) => {
						assert.equal(chunk.chunk_index, index);
						assert.equal(createHash('sha256').update(chunk.text).digest('hex'), chunk.sha256);
						return chunk.text;
					})
					.join('');
				assert.equal(Buffer.byteLength(text), reference.sizeBytes);
				assert.equal(createHash('sha256').update(text).digest('hex'), reference.sha256);
				return text;
			} finally {
				db.close();
			}
		},

		async toolHistory(run) {
			const current = expectStatus(await api('GET', runPath(run)), 200);
			return expectStatus(await api('GET', base() + '/threads/' + current.threadId + '/tools'), 200).items;
		},

		async changeTarget() {
			const target = await app.targets.get(connectionId);
			assert.equal(
				(await app.targets.update(connectionId, target.version, { name: 'changed target' })).status,
				'updated',
			);
		},

		rows(table, run) {
			assert.ok(['agent_runs', 'agent_tool_jobs', 'agent_run_children'].includes(table));
			const db = new DatabaseSync(database, { readOnly: true });
			try {
				const order = table === 'agent_run_children' ? 'rowid' : 'created_at';
				const identity = table === 'agent_runs' ? 'id' : 'run_id';
				return db.prepare('SELECT * FROM ' + table + ' WHERE ' + identity + '=? ORDER BY ' + order).all(run.id);
			} finally {
				db.close();
			}
		},

		facts(run) {
			const db = new DatabaseSync(database, { readOnly: true });
			try {
				return db
					.prepare(
						'SELECT fact_key,value_text,version,author_id FROM agent_run_facts WHERE root_id=? ORDER BY fact_key',
					)
					.all(run.id);
			} finally {
				db.close();
			}
		},

		async restart({ unknown = false, verifyCloseFailure, beforeBoot } = {}) {
			if (verifyCloseFailure) {
				await assert.rejects(app.close(), verifyCloseFailure);
			} else if (unknown) {
				await assert.rejects(app.close(), hasUnknown);
			} else {
				await app.close();
			}
			app = null;
			await beforeBoot?.();
			await boot();
		},
	};
}
