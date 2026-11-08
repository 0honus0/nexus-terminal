import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTools, openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import {
	configureProtocol,
	nextProtocolPermission,
	completeProtocol,
} from '../../runs/support/agent-protocol-fixture.mjs';
import { listAgentApprovalHistory } from '../../runs/support/agent-approval-fixture.mjs';
import { program } from '../../runs/support/acp-server-fixture.mjs';
import { hasToolIdentity } from '../../../../support/package-tool-catalog.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

await test('B10 actual SSH ACP provider and independent permission lifecycle', { timeout: 120000 }, async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-acp-provider-'));
	const sshd = await openSshd(root);
	t.after(() => sshd.close());
	let sequence = 0;

	async function scenario(name, mode, work, { child = false } = {}) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const script = join(directory, 'external-acp.mjs');
			const log = join(directory, 'messages.jsonl');
			await writeFile(script, program);
			const f = await openAgentExecution(directory, sshd, {
				plugin: { selectedRootIds: ['nexus.tools.integrations', 'nexus.tools.agent', 'nexus.services.acp'] },
			});
			const cleanup = { unknown: false };
			scenario.after(() => f.close(cleanup));
			await f.grants([
				'integration.acp.invoke',
				'service.transport.process',
				'context.read',
				'app.intents.exchange',
			]);
			const { instance } = await configureProtocol(f, 'nexus.services.acp', {
				kind: 'remoteProcess',
				connectionId: f.connectionId,
				argv: [process.execPath, script, log, mode],
				cwd: directory,
			});
			let result;
			const execute = discoverTools('acp_execute', (results) => {
				if (results.length === 0)
					return {
						name: 'acp_execute',
						input: { instanceId: instance.id, prompt: 'Execute the controlled callback' },
					};
				result = results[0];
				return { text: 'Protocol complete' };
			});
			let run;
			let rootRun;
			if (child) {
				const objective = f.program('ACP child scope', execute);
				rootRun = await f.start(
					'ACP child owner',
					discoverTools('collaboration_delegate collaboration_join', (results) => {
						if (results.length === 0)
							return {
								name: 'collaboration_delegate',
								input: {
									profile: 'worker',
									objective,
									targets: [String(f.connectionId)],
									dependencyMode: 'success',
								},
							};
						if (results.length === 1)
							return {
								name: 'collaboration_join',
								input: {
									childIds: [results[0].id],
									mode: 'all',
									waitSeconds: 5,
								},
							};
						return { text: 'Child joined' };
					}),
				);
				await f.approve(await f.approval(rootRun, 'collaboration_delegate'));
				const items = await until(
					async () =>
						expectStatus(
							await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + rootRun.id + '/subagents'),
							200,
						).items,
					(items) => items.length === 1,
					'ACP child creation',
				);
				run = items[0];
			} else {
				run = await f.start('ACP ' + mode, execute);
			}
			const session = await until(
				async () =>
					(await listAgentApprovalHistory(f.api, f.appId, run.id)).find(
						(item) => item.status === 'requested' && item.operationName === 'transport.session',
					),
				Boolean,
				'Independent process approval',
			);
			await assert.rejects(stat(log), { code: 'ENOENT' });
			await f.approve(session);
			await work(f, run, log, cleanup, () => result);
			if (rootRun) await f.wait(rootRun, 'completed');
		});
	}

	async function messages(log) {
		return (await readFile(log, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
	}

	async function allow(f, run, log, _cleanup, result) {
		const approval = await nextProtocolPermission(f, run);
		assert.ok(!JSON.stringify(approval).includes('external-private-input'));
		assert.ok(!(await messages(log)).some((item) => item.id === 'permission' && item.method === undefined));
		await f.approve(approval);
		await completeProtocol(f, run);
		const sent = (await messages(log)).find((item) => item.id === 'permission' && item.method === undefined);
		assert.deepEqual(sent.result, { outcome: { outcome: 'selected', optionId: 'one' } });
		assert.equal(result().text, 'permission-one');
		const permission = f.operations(run).find((item) => item.label === 'transport.permission');
		assert.equal(permission.state, 'completed');
		assert.ok(JSON.parse(permission.result_json).sha256, 'Exact response delivery is journalled');
		const tools = await f.toolHistory(run);
		assert.ok(tools.some((item) => hasToolIdentity(item, 'acp_execute') && item.state === 'completed'));
	}

	await scenario('configured provider requires independent allow_once for its inner callback', 'permission', allow);
	await scenario(
		'unadvertised direct filesystem callback is denied',
		'direct',
		async (f, run, log, _cleanup, result) => {
			await completeProtocol(f, run);
			const sent = (await messages(log)).find((item) => item.id === 'direct' && item.method === undefined);
			assert.equal(sent.error.code, -32601);
			assert.equal(sent.result, undefined);
			assert.equal(result().text, 'direct-denied--32601');
		},
	);
	await scenario('child uses the selected provider within inherited authority', 'permission', allow, { child: true });
	await scenario('later invocation requires a fresh process and inner approval', 'permission', allow);
	await scenario(
		'denial delivers reject_once without inheriting transport approval',
		'permission',
		async (f, run, log, _cleanup, result) => {
			const approval = await nextProtocolPermission(f, run);
			expectStatus(
				await f.api(
					'POST',
					'/api/v1/apps/' + f.appId + '/approvals/' + approval.id + '/resolve',
					{
						decision: 'denied',
						expectedVersion: approval.version,
						operationHash: approval.operationHash,
					},
					{ 'Idempotency-Key': randomUUID() },
				),
				200,
			);
			await completeProtocol(f, run);
			assert.equal(
				(await messages(log)).find((item) => item.id === 'permission').result.outcome.optionId,
				'reject',
			);
			assert.equal(result().text, 'permission-reject');
			const permission = f.operations(run).find((item) => item.label === 'transport.permission');
			assert.equal(permission.state, 'failed');
			assert.equal(permission.failure_code, 'forbidden');
		},
	);
	await scenario(
		'cancelling an inner wait cannot deliver a late grant',
		'permission',
		async (f, run, log, cleanup) => {
			const approval = await nextProtocolPermission(f, run);
			await f.cancel(run);
			await f.wait(run, 'cancelled');
			assert.ok(!(await messages(log)).some((item) => item.id === 'permission' && item.method === undefined));
			assert.equal(
				(
					await f.api(
						'POST',
						'/api/v1/apps/' + f.appId + '/approvals/' + approval.id + '/resolve',
						{
							decision: 'approved',
							expectedVersion: approval.version,
							operationHash: approval.operationHash,
						},
						{ 'Idempotency-Key': randomUUID() },
					)
				).status,
				409,
			);
			const operations = f.operations(run);
			assert.ok(
				operations
					.filter((item) => item.kind === 'effect')
					.every((item) => ['completed', 'failed', 'cancelled', 'unknown'].includes(item.state)),
			);
			cleanup.unknown = operations.some((item) => item.state === 'unknown');
			assert.equal(cleanup.unknown, false, 'No effect or grant remains unconfirmed before dispatch');
			const next = await f.start('Same App remains usable after cancellation', () => ({
				text: 'Still available',
			}));
			await f.wait(next, 'completed');
		},
	);
});
