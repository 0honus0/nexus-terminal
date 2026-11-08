import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openMcp } from '../../runs/support/mcp-server-fixture.mjs';
import { configureProtocol } from '../../runs/support/agent-protocol-fixture.mjs';
import { listAgentApprovalHistory } from '../../runs/support/agent-approval-fixture.mjs';
import { openSshd, expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';

const methods = ['tool', 'resource', 'prompt'];

async function fixture(t) {
	const root = await mkdtemp(
		join(
			process.env.NEXUS_TEST_ARTIFACT_DIR ?? process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(),
			'mcp-contract-',
		),
	);
	const sshd = await openSshd(root);
	t.after(() => sshd.close());
	const external = await openMcp();
	t.after(() => external.close());
	const f = await openAgentExecution(root, sshd, {
		discover: 'mcp_discover mcp_tool mcp_resource mcp_prompt',
		plugin: { selectedRootIds: ['nexus.tools.integrations', 'nexus.tools.agent', 'nexus.services.mcp'] },
	});
	t.after(() => f.close());
	await f.grants(['integration.mcp.read', 'integration.mcp.invoke', 'service.transport.http']);
	const { instance } = await configureProtocol(f, 'nexus.services.mcp', {
		kind: 'http',
		endpoint: external.configuration.endpoint,
		privateAuthorities: external.configuration.privateHostExceptions,
	});

	async function invoke(kind, response, inspect) {
		const work = () => response;

		if (kind === 'tool') external.setTool(work);
		else if (kind === 'resource') external.setResource(work);
		else external.setPrompt(work);
		const run = await f.start('MCP contract ' + kind, (results) => {
			if (!results.length) return { name: 'mcp_discover', input: { instanceId: instance.id } };
			if (results.length === 1)
				return {
					name: 'mcp_' + kind,
					input: {
						instanceId: instance.id,
						schemaHash: results[0].schemaHash,
						name: kind === 'tool' ? 'echo' : kind === 'resource' ? 'fixture://document' : 'greeting',
						argumentsJson: '{}',
						resume: null,
						continuation: null,
					},
				};
			inspect(results[1]);
			return { text: 'Contract inspected' };
		});
		const final = await until(
			async () => {
				for (const approval of await listAgentApprovalHistory(f.api, f.appId, run.id))
					if (approval.status === 'requested') await f.approve(approval);
				return expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200);
			},
			(value) => ['completed', 'failed', 'unknown', 'cancelled'].includes(value.status),
			'MCP contract settles',
		);
		await f.wait(run, 'completed');
		assert.equal(final.status, 'completed', JSON.stringify(final));
	}

	return { invoke };
}

await test(
	'MCP Host contract: plugin-owned SDK preserves request-id maps across real managed transport',
	{ timeout: 90000 },
	async (t) => {
		const f = await fixture(t);
		const requests = {
			confirmation: {
				method: 'elicitation/create',
				params: {
					message: 'Untrusted external question',
					requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } },
				},
			},
			sampling: {
				method: 'sampling/createMessage',
				params: { messages: [{ role: 'user', content: { type: 'text', text: '外部内容' } }], maxTokens: 12 },
			},
			roots: { method: 'roots/list' },
			rootsWithMeta: { method: 'roots/list', params: { _meta: { fixture: 'remote-value' } } },
		};
		for (const kind of methods)
			await f.invoke(
				kind,
				{ resultType: 'input_required', requestState: 'local-scoped-continuation', inputRequests: requests },
				(result) => {
					assert.equal(result.kind, 'input_required', JSON.stringify(result));
					assert.equal(result.requestState, 'local-scoped-continuation');
					assert.deepEqual(JSON.parse(result.inputRequestsJson), requests);
					assert.match(result.continuation, /^[a-f0-9-]{36}$/u);
				},
			);
	},
);

await test(
	'MCP Host contract: state-only continuation exposes an empty request-id map',
	{ timeout: 90000 },
	async (t) => {
		const f = await fixture(t);
		// The complete 3-method × 6-shape SDK matrix belongs to the MCP package.
		// Keep one full Host transport/approval/result round-trip for this semantic branch.
		await f.invoke(
			'tool',
			{ resultType: 'input_required', requestState: 'state-only', inputRequests: null },
			(result) => {
				assert.equal(result.kind, 'input_required', JSON.stringify(result));
				assert.deepEqual(JSON.parse(result.inputRequestsJson), {});
				assert.equal(result.requestState, 'state-only');
				assert.match(result.continuation, /^[a-f0-9-]{36}$/u);
			},
		);
	},
);

await test(
	'MCP Host contract: malformed external maps are refused by the actual protocol SDK',
	{ timeout: 180000 },
	async (t) => {
		const f = await fixture(t);
		// All eleven malformed request shapes are exercised directly against the
		// package's official SDK; retain actual rejection projection through Host.
		await f.invoke(
			'tool',
			{
				resultType: 'input_required',
				requestState: 'malformed',
				inputRequests: { bad: { method: 'tools/call', params: {} } },
			},
			(result) => {
				assert.equal(result.kind, undefined, 'Malformed requests must never become resumable input');
				assert.ok(result.failure, JSON.stringify(result));
			},
		);
	},
);
