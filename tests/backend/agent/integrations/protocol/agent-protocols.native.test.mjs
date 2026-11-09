import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { program as acpProgram } from '../../runs/support/acp-server-fixture.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { listAgentApprovalHistory } from '../../runs/support/agent-approval-fixture.mjs';
import { openMcp } from '../../runs/support/mcp-server-fixture.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

const artifactRoot = process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir();

async function configureMcp(f, external) {
	const base = '/api/v1/agent/plugins/apps/' + f.appId + '/instances';
	const instance = expectStatus(await f.api('GET', base), 200).instances.find(
		(item) => item.packageId === 'nexus.services.mcp',
	);
	assert.ok(instance);
	const path = base + '/' + instance.id + '/connection';
	const before = expectStatus(await f.api('GET', path), 200);
	const updated = expectStatus(
		await f.api('PUT', path, {
			expectedRevision: before.revision,
			connector: {
				kind: 'http',
				endpoint: external.configuration.endpoint,
				privateAuthorities: external.configuration.privateHostExceptions,
			},
			credential: { action: 'replace', value: 'mcp-fixture-secret' },
		}),
		200,
	);
	assert.equal(updated.hasCredential, true);
	assert.ok(!JSON.stringify(updated).includes('mcp-fixture-secret'));
	await f.grants(['integration.mcp.read', 'integration.mcp.invoke', 'service.transport.http', 'context.read']);
	return instance;
}

async function settle(f, run, signal) {
	const approved = [];
	const final = await until(
		async () => {
			const approvals = await listAgentApprovalHistory(f.api, f.appId, run.id);
			for (const approval of approvals.filter((item) => item.status === 'requested')) {
				await f.approve(approval);
				approved.push(approval);
			}
			return expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200);
		},
		(value) => ['completed', 'cancelled', 'failed', 'unknown'].includes(value.status),
		'Protocol Run settles',
		signal,
	);
	assert.equal(final.status, 'completed', JSON.stringify(final));
	return approved;
}

for (const continuation of [false, true]) {
	await test(
		'SDK4 MCP real Host transport, independent approvals and ' +
			(continuation ? 'explicit continuation' : 'exact catalog invocation'),
		{ timeout: 60000 },
		async (t) => {
			const directory = await mkdtemp(join(artifactRoot, 'sdk4-mcp-'));
			const sshd = await openSshd(directory);
			t.after(() => sshd.close());
			const external = await openMcp();
			t.after(() => external.close());
			const f = await openAgentExecution(directory, sshd, {
				plugin: {
					uiPackageId: null,
					selectedRootIds: ['nexus.tools.integrations', 'nexus.tools.agent', 'nexus.services.mcp'],
				},
			});
			t.after(() => f.close());
			const instance = await configureMcp(f, external);
			if (continuation)
				external.setTool((params) => {
					if (params.requestState === undefined)
						return { resultType: 'input_required', requestState: 'original-state' };
					assert.equal(params.requestState, 'original-state');
					assert.deepEqual(params.inputResponses, {});
					return { content: [{ type: 'text', text: 'resumed exactly' }] };
				});
			let schemaHash;
			const run = await f.start('SDK4 MCP flow', (results) => {
				if (!results.length) return { name: 'tool_search', input: { query: 'mcp_discover mcp_tool' } };
				if (results.length === 1) return { name: 'mcp_discover', input: { instanceId: instance.id } };
				if (results.length === 2) {
					assert.equal(results[1].catalog.tools[0].name, 'echo', JSON.stringify(results));
					schemaHash = results[1].schemaHash;
					return {
						name: 'mcp_tool',
						input: {
							instanceId: instance.id,
							schemaHash,
							name: 'echo',
							argumentsJson: '{}',
							resume: null,
							continuation: null,
						},
					};
				}
				if (continuation && results.length === 3) {
					assert.equal(results[2].kind, 'input_required', JSON.stringify(results));
					assert.ok(results[2].continuation);
					return {
						name: 'mcp_tool',
						input: {
							instanceId: instance.id,
							schemaHash,
							name: 'echo',
							argumentsJson: '{}',
							continuation: results[2].continuation,
							resume: { requestState: results[2].requestState, inputResponsesJson: '{}' },
						},
					};
				}
				assert.equal(results.at(-1).kind, 'complete', JSON.stringify(results));
				assert.match(results.at(-1).resultJson, continuation ? /resumed exactly/ : /external-result/);
				return { text: 'Protocol complete' };
			});
			const approved = await settle(f, run, t.signal);
			assert.ok(approved.length > 0, 'Runtime byte requests require their own approval');
			assert.ok(external.requests.every((item) => item.authorization === 'Bearer mcp-fixture-secret'));
			const actual = external.requests.filter((item) => item.body.method === 'tools/call');
			assert.equal(actual.length, continuation ? 2 : 1);
			assert.equal(actual[0].body.params.requestState, undefined);
		},
	);
}

for (const mode of ['permission', 'direct', 'large']) {
	await test(
		'SDK4 ACP actual SSH process with ' + mode + ' callback and complete cleanup',
		{ timeout: 60000 },
		async (t) => {
			const directory = await mkdtemp(join(artifactRoot, 'sdk4-acp-'));
			const sshd = await openSshd(directory);
			t.after(() => sshd.close());
			const f = await openAgentExecution(directory, sshd, {
				plugin: {
					uiPackageId: null,
					selectedRootIds: ['nexus.tools.integrations', 'nexus.tools.agent', 'nexus.services.acp'],
				},
			});
			t.after(() => f.close());
			const script = join(directory, 'external.mjs');
			const log = join(directory, 'messages.jsonl');
			await writeFile(script, acpProgram);
			const base = '/api/v1/agent/plugins/apps/' + f.appId + '/instances';
			const instance = expectStatus(await f.api('GET', base), 200).instances.find(
				(item) => item.packageId === 'nexus.services.acp',
			);
			const path = base + '/' + instance.id + '/connection';
			const connection = expectStatus(await f.api('GET', path), 200);
			expectStatus(
				await f.api('PUT', path, {
					expectedRevision: connection.revision,
					connector: {
						kind: 'remoteProcess',
						connectionId: f.connectionId,
						argv: [process.execPath, script, log, mode],
						cwd: directory,
					},
					credential: { action: 'clear' },
				}),
				200,
			);
			await f.grants(['integration.acp.invoke', 'service.transport.process', 'context.read']);
			const run = await f.start('SDK4 ACP ' + mode, (results) => {
				if (!results.length) return { name: 'tool_search', input: { query: 'acp_execute' } };
				if (results.length === 1)
					return {
						name: 'acp_execute',
						input: { instanceId: instance.id, prompt: 'Run controlled callback '.repeat(3000) },
					};
				let result = results[1];
				if (mode === 'large') {
					assert.equal(result.kind, 'captured_result_preview');
					assert.equal(result.truncated, true);
					const projection = result.projection;
					const chunks = [projection.text];
					let offset = projection.nextOffset;
					assert.equal(projection.offset, 0);
					assert.equal(Array.from(projection.text).length, offset);
					assert.ok(Buffer.byteLength(projection.text) < projection.originalBytes);
					for (const [pageIndex, page] of results.slice(2).entries()) {
						assert.equal(page.items.length, 1);
						assert.equal(page.nextIndex, null);
						const item = page.items[0];
						assert.equal(item.toolCallId, projection.toolCallId);
						assert.equal(item.sha256, projection.sha256);
						assert.equal(item.originalBytes, projection.originalBytes);
						assert.equal(item.offset, offset);
						assert.ok(item.text.length > 0);
						assert.ok(Buffer.byteLength(JSON.stringify(item.text)) <= (pageIndex === 0 ? 4096 : 65536));
						if (item.nextOffset !== null) {
							assert.equal(item.nextOffset, offset + Array.from(item.text).length);
						}
						chunks.push(item.text);
						offset = item.nextOffset;
					}
					if (offset !== null) {
						return {
							name: 'tool_result_read',
							input: {
								items: [
									{
										toolCallId: projection.toolCallId,
										sha256: projection.sha256,
										offset,
										// Keep a small first page, then prove the same complete
										// result can continue with larger caller-selected pages.
										maxBytes: results.length === 2 ? 4096 : 65536,
									},
								],
							},
						};
					}
					const text = chunks.join('');
					assert.ok(results.length > 3, 'The model must actually continue reading multiple result pages');
					assert.equal(Buffer.byteLength(text), projection.originalBytes);
					assert.equal(createHash('sha256').update(text).digest('hex'), projection.sha256);
					result = JSON.parse(text);
				}
				assert.equal(result.stopReason, 'end_turn');
				assert.equal(
					result.text,
					mode === 'permission'
						? 'permission-one'
						: mode === 'large'
							? 'x'.repeat(131072)
							: 'direct-denied--32601',
				);
				return { text: 'ACP settled' };
			});
			const approved = await settle(f, run, t.signal);
			assert.ok(approved.some((item) => item.operationName === 'transport.session'));
			const messages = (await readFile(log, 'utf8'))
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			assert.equal(messages.filter((item) => item.method === 'session/prompt').length, 1);
			assert.equal(
				messages.find((item) => item.method === 'session/prompt').params.prompt[0].text,
				'Run controlled callback '.repeat(3000),
			);
			if (mode === 'permission') {
				const decision = messages.find((item) => item.id === 'permission' && item.method === undefined);
				assert.deepEqual(decision.result, { outcome: { outcome: 'selected', optionId: 'one' } });
				assert.ok(!JSON.stringify(approved).includes('external-private-input'));
			} else if (mode === 'direct') {
				assert.equal(
					messages.find((item) => item.id === 'direct' && item.method === undefined).error.code,
					-32601,
				);
			}
		},
	);
}
