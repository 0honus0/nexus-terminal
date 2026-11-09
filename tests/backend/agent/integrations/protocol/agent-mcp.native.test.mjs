import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAgentApprovalHistory } from '../../runs/support/agent-approval-fixture.mjs';
import { configureProtocol } from '../../runs/support/agent-protocol-fixture.mjs';
import { openMcp } from '../../runs/support/mcp-server-fixture.mjs';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

async function pending(f, run) {
	return (await listAgentApprovalHistory(f.api, f.appId, run.id)).filter((item) => item.status === 'requested');
}

function methodFor(f, run, approval) {
	const operation = f.operations(run).find((item) => item.id === approval.operationId);
	assert.ok(operation, 'Approval must refer to the immutable operation');
	if (operation.label !== 'transport.http.request') return null;
	const params = JSON.parse(operation.arguments_json).request.params;
	return params.bodyUtf8 === null ? null : JSON.parse(params.bodyUtf8).method;
}

async function gate(f, run, { stopAtRefresh = false } = {}) {
	return until(
		async () => {
			for (const approval of await pending(f, run)) {
				assert.ok(['transport.session', 'transport.http.request'].includes(approval.operationName));
				const method = methodFor(f, run, approval);
				if (
					method === 'tools/call' ||
					(stopAtRefresh &&
						method === 'tools/list' &&
						f
							.operations(run)
							.some(
								(item) =>
									item.kind === 'tool' &&
									item.label === 'nexus.tools.integrations.mcp_discover' &&
									item.state === 'completed',
							))
				)
					return approval;
				await f.approve(approval);
			}
			const current = expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200);
			assert.ok(
				!['completed', 'failed', 'unknown', 'cancelled'].includes(current.status),
				JSON.stringify(current),
			);
			return null;
		},
		Boolean,
		'Independent MCP outbound invocation approval',
	);
}

async function settle(f, run, status = 'completed') {
	const final = await until(
		async () => {
			for (const approval of await pending(f, run)) {
				assert.ok(['transport.session', 'transport.http.request'].includes(approval.operationName));
				await f.approve(approval);
			}
			return expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200);
		},
		(value) => ['completed', 'failed', 'unknown', 'cancelled'].includes(value.status),
		'MCP Run settles',
	);
	assert.equal(final.status, status, JSON.stringify(final));
	return final;
}

await test('B10 actual MCP integration negotiation and governed execution', async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'nexus-b10-mcp-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, { timeout: 90000 }, async (scenario) => {
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
			f = await openAgentExecution(directory, sshd, {
				discover: 'mcp_discover mcp_tool mcp_resource mcp_prompt',
				plugin: {
					uiPackageId: null,
					selectedRootIds: ['nexus.tools.integrations', 'nexus.tools.agent', 'nexus.services.mcp'],
				},
			});
			await f.grants(['integration.mcp.read', 'integration.mcp.invoke', 'service.transport.http']);
			const { instance } = await configureProtocol(
				f,
				'nexus.services.mcp',
				{
					kind: 'http',
					endpoint: external.configuration.endpoint,
					privateAuthorities: external.configuration.privateHostExceptions,
				},
				{ action: 'replace', value: 'mcp-fixture-secret' },
			);
			await work(f, external, instance, cleanup);
		});
	}

	function discover(integration) {
		return { name: 'mcp_discover', input: { instanceId: integration.id } };
	}

	function invoke(integration, catalog, kind = 'tool', extra = {}) {
		return {
			name: 'mcp_' + kind,
			input: {
				instanceId: integration.id,
				schemaHash: catalog.schemaHash,
				name: kind === 'resource' ? 'fixture://document' : kind === 'prompt' ? 'greeting' : 'echo',
				argumentsJson: '{}',
				resume: null,
				continuation: null,
				...extra,
			},
		};
	}

	try {
		sshd = await openSshd(root);
		await scenario(
			'pinned discovery, independent transport approval, secret boundary and read operations',
			async (f, external, integration) => {
				const run = await f.start('MCP success', (results) => {
					if (results.length === 0) {
						return discover(integration);
					}
					if (results.length === 1) {
						assert.equal(results[0].catalog.tools[0].name, 'echo');
						return invoke(integration, results[0]);
					}
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
				const approval = await gate(f, run);
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 0);
				await f.approve(approval);
				await settle(f, run);
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
				assert.ok(external.requests.every((request) => request.authorization === 'Bearer mcp-fixture-secret'));
				assert.ok(external.requests.some((request) => request.body.method === 'server/discover'));
				assert.ok(!external.requests.some((request) => request.body.method === 'initialize'));
				await f.restart();
				assert.equal((await settle(f, run)).status, 'completed');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
			},
		);
		await scenario(
			'catalog drift after approval request is refused before remote dispatch',
			async (f, external, integration) => {
				const run = await f.start('MCP changed catalog', (results) =>
					results.length > 1 ? {} : results.length ? invoke(integration, results[0]) : discover(integration),
				);
				const approval = await gate(f, run, { stopAtRefresh: true });
				external.changeCatalog();
				await f.approve(approval);
				await settle(f, run);
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 0);
				assert.ok(!(await f.toolHistory(run)).some((item) => item.state === 'unknown'));
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
						assert.equal(results[1].requestState, 'external-private-state');
						assert.match(results[1].continuation, /^[0-9a-f-]{36}$/);
						assert.equal(JSON.parse(results[1].inputRequestsJson).confirm.method, 'elicitation/create');
						return invoke(integration, results[0], 'tool', {
							continuation: results[1].continuation,
							resume: {
								requestState: results[1].requestState,
								inputResponsesJson: JSON.stringify({
									confirm: { action: 'accept', content: { answer: 'yes' } },
								}),
							},
						});
					}
					assert.equal(JSON.parse(results[2].resultJson).content[0].text, 'resumed');
					return {};
				});
				const first = await gate(f, run);
				await f.approve(first);
				const second = await gate(f, run);
				assert.notEqual(second.id, first.id);
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
				await f.approve(second);
				await settle(f, run);
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
							continuation: results[1].continuation,
							resume: { requestState: results[1].requestState, inputResponsesJson: '{}' },
						});
					}
					assert.equal(JSON.parse(results[2].resultJson).content[0].text, 'continued');
					return {};
				});
				await f.approve(await gate(f, run));
				await f.approve(await gate(f, run));
				await settle(f, run);
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
				await f.approve(await gate(f, first));
				await settle(f, first);
				assert.equal(pending.kind, 'input_required');
				const second = await f.start('MCP wrong state owner', (results) =>
					results.length
						? {}
						: invoke(integration, observed, 'tool', {
								continuation: pending.continuation,
								resume: { requestState: pending.requestState, inputResponsesJson: '{}' },
							}),
				);
				await settle(f, second, 'completed');
				assert.equal(external.requests.filter((request) => request.body.method === 'tools/call').length, 1);
			},
		);
		await scenario(
			'private host access requires the exact explicit authority exception',
			async (f, external, integration) => {
				const before = external.requests.length;
				const base = '/api/v1/agent/plugins/apps/' + f.appId + '/instances/' + integration.id + '/connection';
				const connection = expectStatus(await f.api('GET', base), 200);
				expectStatus(
					await f.api('PUT', base, {
						expectedRevision: connection.revision,
						connector: { kind: 'http', endpoint: external.configuration.endpoint, privateAuthorities: [] },
						credential: { action: 'keep' },
					}),
					200,
				);
				const run = await f.start('MCP private authority refused', (results) =>
					results.length ? {} : discover(integration),
				);
				await settle(f, run);
				assert.equal(external.requests.length, before);
				assert.ok((await f.toolHistory(run)).some((item) => item.state === 'failed'));
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
					results.length > 1 ? {} : results.length ? invoke(integration, results[0]) : discover(integration),
				);
				await f.approve(await gate(f, run));
				await settle(f, run, 'unknown');
				assert.equal(effects, 1);
				assert.equal(f.operations(run).at(-1).state, 'unknown');
				await f.restart();
				assert.equal((await settle(f, run, 'unknown')).status, 'unknown');
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
						results.length > 1
							? {}
							: results.length
								? invoke(integration, results[0])
								: discover(integration),
					);
					await f.approve(await gate(f, run));
					await until(
						async () => effects,
						(value) => value === 1,
						'MCP actual dispatch',
					);
					await f.cancel(run);
					release();
					await f.wait(run, 'cancelled');
					await until(
						async () => f.operations(run).at(-1).state,
						(status) => status === 'unknown',
						'MCP unknown after cancellation',
					);
					assert.equal(effects, 1);
					cleanup.unknown = false;
				} finally {
					release();
				}
			},
		);
	} finally {
		await sshd?.close();
	}
});
