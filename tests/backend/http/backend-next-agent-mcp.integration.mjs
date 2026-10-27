import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';

/** The external MCP server is scripted; SDK negotiation, HTTP, authority and SQL stay real. */
async function openMcp() {
	const requests = [];
	const pending = new Set();
	const failures = [];

	let tool = () => ({ content: [{ type: 'text', text: 'external-result' }] });

	let toolName = 'echo';
	const server = createServer((request, response) => {
		const task = Promise.resolve().then(async () => {
			if (request.method !== 'POST') {
				response.writeHead(request.method === 'DELETE' ? 204 : 405).end();
				return;
			}
			const chunks = [];
			for await (const chunk of request) {
				chunks.push(chunk);
			}
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			requests.push({ body, authorization: request.headers.authorization });
			if (body.id === undefined) {
				response.writeHead(202).end();
				return;
			}
			const cached = { ttlMs: 0, cacheScope: 'private' };
			let result;
			switch (body.method) {
				case 'server/discover':
					result = {
						supportedVersions: ['2026-07-28'],
						capabilities: { tools: {}, resources: {}, prompts: {} },
						_meta: { 'io.modelcontextprotocol/serverInfo': { name: 'B10 MCP', version: '1.0.0' } },
					};
					break;
				case 'tools/list':
					result = {
						...cached,
						tools: [{ name: toolName, description: 'Fixture tool', inputSchema: { type: 'object' } }],
					};
					break;
				case 'resources/list':
					result = { ...cached, resources: [{ uri: 'fixture://document', name: 'Document' }] };
					break;
				case 'prompts/list':
					result = { ...cached, prompts: [{ name: 'greeting', description: 'Fixture prompt' }] };
					break;
				case 'resources/read':
					result = { ...cached, contents: [{ uri: 'fixture://document', text: 'resource-value' }] };
					break;
				case 'prompts/get':
					result = { messages: [{ role: 'user', content: { type: 'text', text: 'prompt-value' } }] };
					break;
				case 'tools/call':
					result = await tool(body.params, response);
					if (result === null) {
						return;
					}
					break;
				default:
					assert.fail('Unexpected MCP method: ' + body.method);
			}
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', ...result } }),
			);
		});
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
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const authority = '127.0.0.1:' + server.address().port;
	return {
		requests,
		configuration: {
			kind: 'mcp',
			displayName: 'B10 external MCP',
			endpoint: 'http://' + authority + '/mcp',
			privateHostExceptions: [authority],
			protocolVersion: '2026-07-28',
		},

		setTool(work) {
			tool = work;
		},

		changeCatalog() {
			toolName = 'changed';
		},

		async close() {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			await Promise.allSettled([...pending]);
			assert.deepEqual(failures, []);
		},
	};
}

await test('B10 actual MCP integration negotiation and governed execution', { timeout: 90000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-b10-mcp-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const external = await openMcp();
			let f;
			const cleanup = { unknown: false };
			scenario.after(async () => {
				const outcomes = await Promise.allSettled([
					Promise.resolve().then(() => f?.close(cleanup)),
					external.close(),
				]);
				const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
				if (failures.length) {
					throw new AggregateError(failures, 'MCP fixture cleanup failed');
				}
			});
			f = await openAgentExecution(directory, sshd);
			await f.grants(['integration.mcp.read', 'integration.mcp.invoke']);
			const path = '/api/v1/apps/' + f.appId + '/integrations';
			const input = {
				configuration: external.configuration,
				enabled: true,
				credential: { action: 'replace', value: 'mcp-fixture-secret' },
			};
			const key = randomUUID();
			const integration = expectStatus(await f.api('POST', path, input, { 'Idempotency-Key': key }), 201);
			assert.deepEqual(
				expectStatus(await f.api('POST', path, input, { 'Idempotency-Key': key }), 201),
				integration,
			);
			assert.equal(integration.hasCredential, true);
			assert.ok(!JSON.stringify(integration).includes('mcp-fixture-secret'));
			const discovery = expectStatus(
				await f.api('POST', path + '/' + integration.id + '/refresh', { expectedVersion: integration.version }),
				200,
			);
			assert.equal(discovery.serverName, 'B10 MCP');
			assert.equal(discovery.protocolVersion, '2026-07-28');
			assert.equal(discovery.tools[0].name, 'echo');
			await work(f, external, discovery.integration, cleanup);
		});
	}

	function discover(integration) {
		return { name: 'mcp_discover', input: { integrationId: integration.id, version: integration.version } };
	}

	function invoke(integration, catalog, kind = 'tool', extra = {}) {
		return {
			name: 'mcp_' + kind,
			input: {
				integrationId: integration.id,
				version: integration.version,
				schemaHash: catalog.schemaHash,
				name: kind === 'resource' ? 'fixture://document' : kind === 'prompt' ? 'greeting' : 'echo',
				argumentsJson: '{}',
				...extra,
			},
		};
	}

	try {
		sshd = await openSshd(root);
		await scenario(
			'management replay, pinned discovery, independent approval and read operations',
			async (f, external, integration) => {
				const run = await f.start('MCP success', (results) => {
					if (results.length === 0) {
						return discover(integration);
					}
					if (results.length === 1) {
						assert.equal(results[0].untrusted, true);
						return invoke(integration, results[0]);
					}
					assert.equal(results.at(-1).untrusted, true);
					assert.equal(results.at(-1).kind, 'complete');
					if (results.length === 2) {
						assert.equal(JSON.parse(results[1].resultJson).content[0].text, 'external-result');
						return invoke(integration, results[0], 'resource');
					}
					if (results.length === 3) {
						assert.equal(JSON.parse(results[2].resultJson).contents[0].text, 'resource-value');
						return invoke(integration, results[0], 'prompt');
					}
					assert.equal(JSON.parse(results[3].resultJson).messages[0].content.text, 'prompt-value');
					return {};
				});
				const approval = await f.approval(run, 'mcp_tool');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 0);
				await f.approve(approval);
				await f.wait(run, 'completed');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
				assert.ok(external.requests.every((request) => request.authorization === 'Bearer mcp-fixture-secret'));
				assert.ok(external.requests.some((request) => request.body.method === 'server/discover'));
				assert.ok(!external.requests.some((request) => request.body.method === 'initialize'));
				await f.restart();
				assert.equal((await f.wait(run, 'completed')).status, 'completed');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
			},
		);
		await scenario(
			'catalog drift after approval request is refused before remote dispatch',
			async (f, external, integration) => {
				const run = await f.start('MCP changed catalog', (results) =>
					results.length ? invoke(integration, results[0]) : discover(integration),
				);
				const approval = await f.approval(run, 'mcp_tool');
				external.changeCatalog();
				await f.approve(approval);
				await f.wait(run, 'unknown');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 0);
				assert.equal(f.rows('agent_run_tools', run).at(-1).state, 'unknown');
			},
		);
		await scenario(
			'input_required wraps remote state and each explicit resumption needs a new approval',
			async (f, external, integration) => {
				external.setTool((params) => {
					if (params.requestState === undefined) {
						return {
							resultType: 'input_required',
							requestState: 'external-private-state',
							inputRequests: {
								confirm: {
									method: 'elicitation/create',
									params: {
										message: 'Untrusted external question',
										requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } },
									},
								},
							},
						};
					}
					assert.equal(params.requestState, 'external-private-state');
					assert.deepEqual(params.inputResponses, {
						confirm: { action: 'accept', content: { answer: 'yes' } },
					});
					return { content: [{ type: 'text', text: 'resumed' }] };
				});
				const run = await f.start('MCP explicit resume', (results) => {
					if (!results.length) {
						return discover(integration);
					}
					if (results.length === 1) {
						return invoke(integration, results[0]);
					}
					if (results.length === 2) {
						assert.equal(results[1].kind, 'input_required');
						assert.equal(results[1].untrusted, true);
						assert.notEqual(results[1].requestState, 'external-private-state');
						assert.match(results[1].requestState, /^[0-9a-f-]{36}$/);
						assert.equal(JSON.parse(results[1].inputRequestsJson).confirm.method, 'elicitation/create');
						return invoke(integration, results[0], 'tool', {
							requestState: results[1].requestState,
							inputResponsesJson: JSON.stringify({
								confirm: { action: 'accept', content: { answer: 'yes' } },
							}),
						});
					}
					assert.equal(JSON.parse(results[2].resultJson).content[0].text, 'resumed');
					return {};
				});
				const first = await f.approval(run, 'mcp_tool');
				await f.approve(first);
				const second = await f.approval(run, 'mcp_tool');
				assert.notEqual(second.id, first.id);
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
				await f.approve(second);
				await f.wait(run, 'completed');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 2);
			},
		);
		await scenario(
			'state-only input_required is a valid explicit continuation',
			async (f, external, integration) => {
				external.setTool((params) =>
					params.requestState === undefined
						? { resultType: 'input_required', requestState: 'state-without-input-requests' }
						: { content: [{ type: 'text', text: 'continued' }] },
				);
				const run = await f.start('MCP state-only continuation', (results) => {
					if (!results.length) {
						return discover(integration);
					}
					if (results.length === 1) {
						return invoke(integration, results[0]);
					}
					if (results.length === 2) {
						assert.equal(results[1].kind, 'input_required');
						assert.deepEqual(JSON.parse(results[1].inputRequestsJson), {});
						return invoke(integration, results[0], 'tool', {
							requestState: results[1].requestState,
							inputResponsesJson: '{}',
						});
					}
					assert.equal(JSON.parse(results[2].resultJson).content[0].text, 'continued');
					return {};
				});
				await f.approve(await f.approval(run, 'mcp_tool'));
				await f.approve(await f.approval(run, 'mcp_tool'));
				await f.wait(run, 'completed');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 2);
			},
		);
		await scenario(
			'continuation cannot cross Run ownership after its original Run drains',
			async (f, external, integration) => {
				let observed;
				let pending;
				external.setTool(() => ({
					resultType: 'input_required',
					requestState: 'private-scoped-state',
					inputRequests: {},
				}));
				const first = await f.start('MCP pending state owner', (results) => {
					if (!results.length) {
						return discover(integration);
					}
					if (results.length === 1) {
						observed = results[0];
						return invoke(integration, observed);
					}
					pending = results[1];
					return {};
				});
				await f.approve(await f.approval(first, 'mcp_tool'));
				await f.wait(first, 'completed');
				assert.equal(pending.kind, 'input_required');
				const second = await f.start('MCP wrong state owner', () =>
					invoke(integration, observed, 'tool', {
						requestState: pending.requestState,
						inputResponsesJson: '{}',
					}),
				);
				await f.approve(await f.approval(second, 'mcp_tool'));
				await f.wait(second, 'unknown');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
			},
		);
		await scenario(
			'private host access requires the exact explicit authority exception',
			async (f, external, integration) => {
				const path = '/api/v1/apps/' + f.appId + '/integrations/' + integration.id;
				const before = external.requests.length;
				const updated = expectStatus(
					await f.api('PATCH', path, {
						expectedVersion: integration.version,
						configuration: { ...external.configuration, privateHostExceptions: [] },
						enabled: true,
						credential: { action: 'keep' },
					}),
					200,
				);
				const response = await f.api('POST', path + '/refresh', { expectedVersion: updated.version });
				assert.equal(response.status, 503);
				assert.deepEqual(response.body, { code: 'provider_unavailable' });
				assert.equal(external.requests.length, before);
			},
		);
		await scenario(
			'remote effect followed by response disconnect stays unknown and never replays',
			async (f, external, integration, cleanup) => {
				let effects = 0;
				external.setTool((_params, response) => {
					effects++;
					response.destroy();
					return null;
				});
				const run = await f.start('MCP broken response', (results) =>
					results.length ? invoke(integration, results[0]) : discover(integration),
				);
				await f.approve(await f.approval(run, 'mcp_tool'));
				await f.wait(run, 'unknown');
				assert.equal(effects, 1);
				assert.equal(f.rows('agent_run_tools', run).at(-1).state, 'unknown');
				await f.restart({ unknown: true });
				assert.equal((await f.wait(run, 'unknown')).status, 'unknown');
				assert.equal(effects, 1);
				cleanup.unknown = false;
			},
		);
		await scenario(
			'run cancellation after actual dispatch preserves external uncertainty',
			async (f, external, integration, cleanup) => {
				let effects = 0;
				let release;
				const barrier = new Promise((resolve) => {
					release = resolve;
				});
				external.setTool(async () => {
					effects++;
					await barrier;
					return { content: [{ type: 'text', text: 'late effect' }] };
				});
				try {
					const run = await f.start('MCP cancel after dispatch', (results) =>
						results.length ? invoke(integration, results[0]) : discover(integration),
					);
					await f.approve(await f.approval(run, 'mcp_tool'));
					await until(
						async () => effects,
						(value) => value === 1,
						'MCP actual dispatch',
					);
					await f.cancel(run);
					release();
					await f.wait(run, 'cancelled');
					await until(
						async () => f.rows('agent_run_tools', run).at(-1).state,
						(status) => status === 'unknown',
						'MCP unknown after cancellation',
					);
					assert.equal(effects, 1);
					cleanup.unknown = true;
				} finally {
					release();
				}
			},
		);
	} finally {
		await sshd?.close();
		await rm(root, { recursive: true, force: true });
	}
});
