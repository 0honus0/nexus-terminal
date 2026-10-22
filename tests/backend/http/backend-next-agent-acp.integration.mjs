import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';

/** Runs across the real SSH channel; only the external ACP executable is scripted. */
const program = `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const log = process.argv[2];
const mode = process.argv[3];
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
let prompt;
for await (const line of createInterface({ input: process.stdin })) {
 const message = JSON.parse(line);
 appendFileSync(log, JSON.stringify(message) + '\\n');
 if (message.method === 'initialize') {
  if (Object.keys(message.params.clientCapabilities).length) throw new Error('Unexpected direct capabilities');
  send({ id: message.id, result: { protocolVersion: 1 } });
 } else if (message.method === 'session/new') {
  send({ id: message.id, result: { sessionId: 'external-session' } });
 } else if (message.method === 'session/prompt') {
  prompt = message.id;
  if (mode === 'permission') {
   send({ id: 'permission', method: 'session/request_permission', params: {
    sessionId: 'external-session', toolCall: { toolCallId: 'external-tool', title: 'Write requested externally', kind: 'edit', rawInput: { secret: 'external-private-input' } },
    options: [{ optionId: 'one', kind: 'allow_once', name: 'Once' }, { optionId: 'always', kind: 'allow_always', name: 'Always' }, { optionId: 'reject', kind: 'reject_once', name: 'Reject' }]
   } });
  } else if (mode === 'direct') {
   send({ id: 'direct', method: 'fs/read_text_file', params: { path: '/etc/passwd' } });
  }
 } else if (message.id === 'permission' || message.id === 'direct') {
  send({ method: 'session/update', params: { sessionId: 'external-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: message.id === 'permission' ? 'permission-' + message.result.outcome.optionId : 'direct-denied-' + message.error.code } } } });
  send({ id: prompt, result: { stopReason: 'end_turn' } });
 }
}
`;

await test('B10 actual SSH ACP integration and inner permissions', { timeout: 60000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-b10-acp-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, mode, work, { child = false, direct = false } = {}) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const script = join(directory, 'external-acp.mjs');
			const log = join(directory, 'messages.jsonl');
			await writeFile(script, program);
			const f = await openAgentExecution(directory, sshd);
			const cleanup = { unknown: false };
			scenario.after(() => f.close(cleanup));
			await f.grants(['integration.acp.invoke', 'app.intents.exchange']);
			const integration = expectStatus(
				await f.api(
					'POST',
					'/api/v1/apps/' + f.appId + '/integrations',
					{
						configuration: {
							kind: 'acp',
							displayName: 'SSH ACP fixture',
							connectionId: f.connectionId,
							argv: [process.execPath, script, log, mode],
							cwd: directory,
							protocolVersion: '1',
						},
						enabled: true,
						credential: { action: 'clear' },
					},
					{ 'Idempotency-Key': randomUUID() },
				),
				201,
			);

			const execute = (results) => {
				if (!results.length) {
					if (direct) {
						return {
							name: 'acp_execute',
							input: {
								connectionId: f.connectionId,
								argv: [process.execPath, script, log, mode],
								cwd: directory,
								prompt: 'Execute this fixture request',
							},
						};
					}
					return {
						name: 'acp_integration_execute',
						input: {
							integrationId: integration.id,
							version: integration.version,
							prompt: 'Execute this fixture request',
						},
					};
				}
				return {};
			};

			let run;
			let rootRun;
			if (child) {
				const objective = f.program('ACP restricted Child', execute);
				rootRun = await f.start('ACP Child owner', (results) => {
					if (!results.length) {
						return {
							name: 'collaboration_delegate',
							input: {
								profile: 'worker',
								objective,
								targets: [String(f.connectionId)],
								dependencyMode: 'success',
							},
						};
					}
					if (results.length === 1) {
						return {
							name: 'collaboration_join',
							input: { childIds: [results[0].id], mode: 'all', waitSeconds: 5 },
						};
					}
					return {};
				});
				await f.approve(await f.approval(rootRun, 'collaboration_delegate'));
				const items = await until(
					async () =>
						expectStatus(
							await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + rootRun.id + '/subagents'),
							200,
						).items,
					(items) => items.length === 1,
					'ACP Child',
				);
				run = items[0];
			} else {
				run = await f.start('ACP ' + mode, execute);
			}
			const outer = await f.approval(run, direct ? 'acp_execute' : 'acp_integration_execute');
			await assert.rejects(stat(log), { code: 'ENOENT' });
			await f.approve(outer);
			await work(f, run, log, cleanup);
			if (rootRun) {
				await f.wait(rootRun, 'completed');
			}
		});
	}

	async function messages(log) {
		return (await readFile(log, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
	}

	try {
		sshd = await openSshd(root);
		await scenario(
			'saved integration requires independent allow_once for inner permission',
			'permission',
			async (f, run, log) => {
				const approval = await f.approval(run, 'acp_inner_permission');
				assert.equal(approval.kind, 'acp_permission');
				assert.ok(!JSON.stringify(approval).includes('external-private-input'));
				assert.ok(!(await messages(log)).some((message) => message.id === 'permission'));
				await f.approve(approval);
				await f.wait(run, 'completed');
				const sent = (await messages(log)).find((message) => message.id === 'permission');
				assert.deepEqual(sent.result, { outcome: { outcome: 'selected', optionId: 'one' } });
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((row) => row.state),
					['completed', 'completed'],
				);
				assert.equal(JSON.parse(f.rows('agent_run_tools', run)[0].result_text).text, 'permission-one');
			},
		);
		await scenario('unadvertised direct filesystem callback is denied', 'direct', async (f, run, log) => {
			await f.wait(run, 'completed');
			const sent = (await messages(log)).find((message) => message.id === 'direct');
			assert.equal(sent.error.code, -32601);
			assert.equal(sent.result, undefined);
			assert.equal(JSON.parse(f.rows('agent_run_tools', run)[0].result_text).text, 'direct-denied--32601');
		});
		await scenario(
			'restricted Child allows saved ACP parent without granting direct ACP execution',
			'permission',
			async (f, run, log) => {
				await f.approve(await f.approval(run, 'acp_inner_permission'));
				await f.wait(run, 'completed');
				assert.equal(
					(await messages(log)).find((message) => message.id === 'permission').result.outcome.optionId,
					'one',
				);
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((row) => row.tool_name),
					['acp_integration_execute', 'acp_inner_permission'],
				);
			},
			{ child: true },
		);
		await scenario(
			'direct ACP retains its independent inner approval',
			'permission',
			async (f, run, log) => {
				await f.approve(await f.approval(run, 'acp_inner_permission'));
				await f.wait(run, 'completed');
				assert.equal(
					(await messages(log)).find((message) => message.id === 'permission').result.outcome.optionId,
					'one',
				);
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((row) => row.tool_name),
					['acp_execute', 'acp_inner_permission'],
				);
			},
			{ direct: true },
		);
		await scenario(
			'denied inner permission delivers reject_once without inheriting parent approval',
			'permission',
			async (f, run, log) => {
				const approval = await f.approval(run, 'acp_inner_permission');
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
				await f.wait(run, 'completed');
				assert.equal(
					(await messages(log)).find((message) => message.id === 'permission').result.outcome.optionId,
					'reject',
				);
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((row) => row.state),
					['completed', 'cancelled'],
				);
			},
		);
		await scenario(
			'cancel while inner permission waits cannot publish a grant',
			'permission',
			async (f, run, log, cleanup) => {
				const approval = await f.approval(run, 'acp_inner_permission');
				await f.cancel(run);
				await f.wait(run, 'cancelled');
				await until(
					async () => f.rows('agent_run_tools', run).map((row) => row.state),
					(states) => states.every((state) => state === 'unknown' || state === 'cancelled'),
					'ACP cancellation settlement',
				);
				assert.ok(!(await messages(log)).some((message) => message.id === 'permission'));
				const reply = await f.api(
					'POST',
					'/api/v1/apps/' + f.appId + '/approvals/' + approval.id + '/resolve',
					{ decision: 'approved', expectedVersion: approval.version, operationHash: approval.operationHash },
					{ 'Idempotency-Key': randomUUID() },
				);
				assert.equal(reply.status, 409);
				cleanup.unknown = true;
			},
		);
	} finally {
		await sshd?.close();
		await rm(root, { recursive: true, force: true });
	}
});
