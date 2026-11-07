import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import { openSshd, expectStatus, until } from '../remote/openssh-fixture.mjs';
import {
	chatModelRequest,
	responseModelRequest,
} from '../../../packages/backend/dist/platform/ai/adapters/model-request.js';
import { ModelNetworkFailure } from '../../../packages/backend/dist/platform/ai/model-port.js';
import { AGENT_CAPABILITIES } from '../../../packages/shared/dist/agent/governance/values.js';

const artifactRoot = process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir();

await test(
	'Agent tools: live catalog, large conversation and model adapter budgets stay independent',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(artifactRoot, 'nexus-agent-tool-budgets-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd);
		t.after(() => f.close());
		await f.grants(AGENT_CAPABILITIES);
		let definitions;
		const run = await f.start('Complete live catalog', (results, body) => {
			if (!results.length) return { name: 'tool_search', input: { query: '*' } };
			assert.ok(body.tools.length > 32, 'Full authorized catalog is independent of per-turn tool-call capacity');
			definitions = body.tools.map((entry) => ({
				name: entry.function.name,
				description: entry.function.description,
				parameters: { schemaJson: JSON.stringify(entry.function.parameters) },
			}));
			return { text: 'Complete catalog and conversation accepted' };
		});
		await f.wait(run, 'completed');
		assert.equal(f.calls.length, 2);
		for (const [protocol, encode] of [
			['chat-completions', chatModelRequest],
			['responses', responseModelRequest],
		]) {
			const input = {
				baseUrl: 'http://127.0.0.1/v1',
				protocol,
				modelId: 'fixture',
				credential: null,
				maxOutputTokens: 256,
				usesReasoning: false,
				messages: [{ role: 'user', content: 'x'.repeat(33000) }],
				tools: definitions,
			};
			assert.equal(encode(input).tools.length, definitions.length);
			const catalog = Array.from({ length: 160 }, (_, index) => ({
				...definitions[0],
				name: 'tool_' + index,
			}));
			assert.equal(encode({ ...input, tools: catalog }).tools.length, 160);

			const invalid = (error) => error instanceof ModelNetworkFailure && error.kind === 'response_invalid';

			assert.throws(() => encode({ ...input, tools: [...catalog, { ...catalog[0] }] }), invalid);
			const calls = Array.from({ length: 48 }, (_, index) => ({
				id: 'call_' + index,
				name: definitions[0].name,
				argumentsJson: '{}',
			}));

			const history = (toolCalls) => [
				...input.messages,
				{ role: 'assistant', content: '', reasoning: [], toolCalls },
				...toolCalls.map((call) => ({ role: 'tool', callId: call.id, content: '{}' })),
			];

			assert.ok(encode({ ...input, messages: history(calls) }));
			assert.throws(() => encode({ ...input, messages: history([...calls, { ...calls[0] }]) }), invalid);
		}
	},
);

await test('Agent tools: exact approvals, actual SSH effects and live revocation', { timeout: 90000 }, async (t) => {
	const directory = await mkdtemp(join(artifactRoot, 'nexus-agent-tool-approvals-'));
	const sshd = await openSshd(directory);
	t.after(() => sshd.close());
	const f = await openAgentExecution(directory, sshd, { discover: 'file_write' });
	t.after(() => f.close());
	await f.grants(['file.write']);
	const base = '/api/v1/agent/apps/' + f.appId;

	const approvalPath = (approval) => '/api/v1/apps/' + f.appId + '/approvals/' + approval.id;

	const approvals = (run) => listAgentApprovalHistory(f.api, f.appId, run.id);

	const operation = (run, approval) => {
		const effect = f.operations(run).find((row) => row.id === approval.operationId);
		assert.ok(effect);
		assert.equal(effect.label, 'remote.write');
		const parent = f.operations(run).find((row) => row.id === effect.parent_id);
		assert.ok(parent && parent.kind === 'tool');
		return { effect, parent };
	};

	const absent = (path) => assert.rejects(stat(path), { code: 'ENOENT' });

	async function start(name) {
		const path = join(directory, name + '.txt');
		const content = ('private-content-' + name).repeat(name === 'approved' ? 5000 : 1);
		const run = await f.start(name, (results) =>
			results.length
				? { text: 'Write settled' }
				: {
						name: 'file_write',
						input: {
							connectionId: f.connectionId,
							items: [{ path, content, expectedSha256: 'absent' }],
						},
					},
		);
		const approval = await f.approval(run, 'file_write');
		assert.equal(approval.operationName, 'remote.write');
		assert.ok(!JSON.stringify(approval).includes(content), 'Approval projects evidence, not private file body');
		assert.equal(operation(run, approval).effect.state, 'accepted');
		await absent(path);
		return { run, approval, path, content };
	}

	const resolve = (approval, decision, key = randomUUID()) =>
		f.api(
			'POST',
			approvalPath(approval) + '/resolve',
			{
				decision,
				operationHash: approval.operationHash,
				expectedVersion: approval.version,
			},
			{ 'Idempotency-Key': key },
		);

	await t.test('concurrent identical approval consumes once and completes one actual SSH write', async () => {
		const { run, approval, path, content } = await start('approved');
		expectStatus(
			await f.api(
				'POST',
				approvalPath(approval) + '/resolve',
				{
					decision: 'approved',
					operationHash: '0'.repeat(64),
					expectedVersion: approval.version,
				},
				{ 'Idempotency-Key': randomUUID() },
			),
			409,
		);
		const key = randomUUID();
		for (const response of await Promise.all([
			resolve(approval, 'approved', key),
			resolve(approval, 'approved', key),
		])) {
			assert.equal(expectStatus(response, 200).status, 'approved');
		}
		await f.wait(run, 'completed');
		assert.equal(await readFile(path, 'utf8'), content);
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		const settled = (await approvals(run)).find((item) => item.id === approval.id);
		assert.ok(settled.consumedAt !== null);
		const { effect, parent } = operation(run, approval);
		assert.equal(effect.state, 'completed');
		assert.equal(parent.state, 'completed');
		assert.equal(JSON.parse(effect.arguments_json).items[0].content, content);
		assert.equal(expectStatus(await resolve(approval, 'approved', key), 200).status, 'approved');
		const details = expectStatus(await f.api('GET', base + '/runs/' + run.id + '/tools/' + parent.id), 200);
		assert.equal(details.tool.id, parent.id);
		assert.equal(details.failureCode, null);
		assert.equal(JSON.parse(details.argumentsJson).items[0].content, content);
		assert.equal(f.calls.length, 3);
		assert.equal(f.operations(run).filter((row) => row.label === 'remote.write').length, 1);
		for (const suffix of ['/steps/1', '/tools/' + parent.id + '/events?after=0&limit=50']) {
			expectStatus(await f.api('GET', base + '/runs/' + run.id + suffix), 404);
		}
	});
	await t.test('denial dispatches no write and the App receives a recoverable refusal', async () => {
		const before = f.calls.length;
		const { run, approval, path } = await start('denied');
		assert.equal(expectStatus(await resolve(approval, 'denied'), 200).status, 'denied');
		await f.wait(run, 'completed');
		await absent(path);
		assert.equal(operation(run, approval).effect.state, 'failed');
		assert.equal((await approvals(run))[0].consumedAt, null);
		assert.equal(f.calls.length, before + 3);
		const refusal = JSON.parse(f.calls.at(-1).body.messages.findLast((message) => message.role === 'tool').content);
		assert.equal(refusal.failure.code, 'forbidden');
		assert.equal(f.operations(run).filter((row) => row.label === 'remote.write').length, 1);
	});
	await t.test('Run cancellation fences the original pending approval', async () => {
		const { run, approval, path } = await start('cancelled');
		await f.cancel(run);
		await f.wait(run, 'cancelled');
		expectStatus(await resolve(approval, 'approved'), 409);
		assert.equal(operation(run, approval).effect.state, 'cancelled');
		await absent(path);
	});
	await t.test('restoring revoked permission cannot revive an old approval', async () => {
		const { run, approval, path } = await start('revoked');
		await f.grants([]);
		await f.wait(run, 'failed');
		expectStatus(await resolve(approval, 'approved'), 409);
		await f.grants(['file.write']);
		expectStatus(await resolve(approval, 'approved'), 409);
		await absent(path);
	});
	await t.test('target denylisting fences dispatch even if an old approval is presented', async () => {
		const { run, approval, path } = await start('denylisted');
		const denylist = expectStatus(await f.api('GET', '/api/v1/agent/target-denylist'), 200);
		expectStatus(
			await f.api('PUT', '/api/v1/agent/target-denylist', {
				expectedRevision: denylist.revision,
				connectionIds: [f.connectionId],
				reason: 'isolated regression',
			}),
			200,
		);
		await f.wait(run, 'cancelled');
		await until(
			() => operation(run, approval).effect.state,
			(state) => state === 'cancelled',
			'Denylisted effect settles',
		);
		expectStatus(await resolve(approval, 'approved'), 409);
		assert.equal((await approvals(run))[0].consumedAt, null);
		await absent(path);
	});
});
