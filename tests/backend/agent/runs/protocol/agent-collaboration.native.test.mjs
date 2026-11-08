import { posixCommand } from '../../../../support/posix-command.mjs';
import { listAgentApprovalHistory } from '../support/agent-approval-fixture.mjs';
import assert from 'node:assert/strict';
import {
	packageTool,
	findFixtureTool,
	fixtureToolName,
	rawToolName,
} from '../../../../support/package-tool-catalog.mjs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from '../support/agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

await test('B10 actual Root/Child collaboration ownership', { timeout: 180000 }, async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-b10-collaboration-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, work, options = {}) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const f = await openAgentExecution(directory, sshd, {
				discover:
					'collaboration_delegate collaboration_join collaboration_cancel collaboration_list collaboration_message_send collaboration_message_read collaboration_message_consume collaboration_fact_write collaboration_fact_read file_read file_write shell_execute',
				...options,
			});
			const releases = [];
			const cleanup = { unknown: false };
			scenario.after(async () => {
				for (const release of releases) {
					release();
				}
				await f.close(cleanup);
			});
			await f.grants(['app.intents.exchange', 'file.read', 'file.write']);
			try {
				await work(f, directory, releases, cleanup);
			} catch (error) {
				const db = new DatabaseSync(join(directory, 'state.db'), { readOnly: true });
				try {
					scenario.diagnostic(
						JSON.stringify({
							runs: db.prepare('SELECT id,status,version FROM agent_runs').all(),
							tools: db
								.prepare(
									'SELECT id,run_id,parent_id,label,state,revision,failure_code FROM agent_operations',
								)
								.all(),
							children: db.prepare('SELECT run_id,parent_id FROM agent_run_children').all(),
							jobs: db.prepare('SELECT id,run_id,state FROM agent_tool_jobs').all(),
						}),
					);
				} finally {
					db.close();
				}
				throw error;
			}
		});
	}

	const childPath = (f, run) => '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id + '/subagents';

	async function children(f, run, count) {
		return until(
			async () => expectStatus(await f.api('GET', childPath(f, run)), 200).items,
			(items) => items.length === count,
			'Expected children',
		);
	}

	function delegate(objective, extra = {}) {
		return {
			name: 'collaboration_delegate',
			input: {
				profile: 'explore',
				objective,
				dependencyMode: 'success',
				...extra,
			},
		};
	}

	function completedPackageCalls(f, directory, run, expected) {
		const rows = f.operations(run);
		const packages = rows.filter((row) => row.kind === 'tool' && row.label !== 'nexus.tools.agent.tool_search');
		assert.equal(packages.length, expected.length);
		const effects = rows.filter((row) => row.kind === 'effect');
		assert.equal(effects.length, expected.length);
		assert.ok(rows.every((row) => row.state === 'completed'));
		const db = new DatabaseSync(join(directory, 'state.db'), { readOnly: true });
		try {
			for (const [name, operation] of expected) {
				const parent = packages.find((row) => row.label === 'nexus.tools.agent.' + name);
				assert.ok(parent, 'Expected completed package call: ' + name);
				const binding = JSON.parse(parent.binding_json);
				assert.equal(binding.kind, 'registry');
				assert.equal(binding.package.packageId, 'nexus.tools.agent');
				assert.equal(
					createHash('sha256')
						.update(JSON.stringify([binding.binding.id, parent.arguments_json]))
						.digest('hex'),
					parent.request_hash,
				);
				const descendants = effects.filter((row) => row.parent_id === parent.id);
				assert.equal(descendants.length, 1);
				const [child] = descendants;
				assert.equal(child.label, operation);
				assert.equal(JSON.parse(child.binding_json).kind, 'native');
				const proof = JSON.parse(
					db.prepare('SELECT proof_json FROM agent_operation_authorities WHERE operation_id=?').get(child.id)
						.proof_json,
				);
				assert.equal(proof.instance.packageId, 'nexus.tools.agent');
				assert.equal(proof.instance.id, binding.binding.instanceId);
			}
		} finally {
			db.close();
		}
	}

	try {
		sshd = await openSshd(root);
		await scenario('Root cancel fences a running Child and a pending dependency without replay', async (f) => {
			const first = f.program('running child', () => ({ hold: true }));
			const second = f.program('dependent child', () => assert.fail('Dependent Provider must not dispatch'));
			const run = await f.start('cancel family', (results) => {
				if (!results.length) {
					return delegate(first);
				}
				if (results.length === 1) {
					return delegate(second, { dependencies: [results[0].id] });
				}
				return { hold: true };
			});
			await f.approve(await f.approval(run, 'collaboration_delegate'));
			await until(
				async () => f.calls,
				(calls) => calls.some((call) => call.key === first),
				'Child dispatch',
			);
			await f.approve(await f.approval(run, 'collaboration_delegate'));
			const items = await children(f, run, 2);
			assert.deepEqual(items.map((child) => child.status).sort(), ['pending', 'running']);
			await f.cancel(run);
			await f.wait(run, 'cancelled');
			await until(
				async () => children(f, run, 2),
				(values) => values.every((child) => child.status === 'cancelled'),
				'Whole family fenced',
			);
			const calls = f.calls.length;
			await f.restart();
			assert.equal(f.calls.length, calls);
			assert.ok((await children(f, run, 2)).every((child) => child.status === 'cancelled'));
		});
		await scenario(
			'Child cancellation invalidates its pending write approval while allowing the parent to finish',
			async (f, directory, releases, cleanup) => {
				const unrelated = await f.start('unrelated family', () => ({}));
				await f.wait(unrelated, 'completed');
				const path = join(directory, 'must-not-exist');
				const objective = f.program('worker child', () => ({
					name: 'file_write',
					input: {
						connectionId: f.connectionId,
						items: [{ path, content: 'forbidden after cancel', expectedSha256: 'absent' }],
					},
				}));
				const run = await f.start('independent approval', (results) =>
					results.length
						? { hold: true }
						: delegate(objective, { profile: 'worker', targets: [String(f.connectionId)] }),
				);
				await f.approve(await f.approval(run, 'collaboration_delegate'));
				const [child] = await children(f, run, 1);
				const approval = await f.approval(child, 'file_write');
				expectStatus(
					await f.api(
						'POST',
						childPath(f, unrelated) + '/' + child.id + '/cancel',
						{
							expectedVersion: child.version,
						},
						{ 'Idempotency-Key': randomUUID() },
					),
					404,
				);
				expectStatus(await f.api('GET', childPath(f, unrelated) + '/' + child.id + '/messages'), 404);
				const endpoint = childPath(f, run) + '/' + child.id + '/cancel';
				const key = { 'Idempotency-Key': randomUUID() };
				const input = { expectedVersion: (await children(f, run, 1))[0].version };
				expectStatus(await f.api('POST', endpoint, input, key), 200);
				expectStatus(await f.api('POST', endpoint, input, key), 200);
				expectStatus(
					await f.api(
						'POST',
						'/api/v1/apps/' + f.appId + '/approvals/' + approval.id + '/resolve',
						{
							decision: 'approved',
							operationHash: approval.operationHash,
							expectedVersion: approval.version,
						},
						{ 'Idempotency-Key': randomUUID() },
					),
					409,
				);
				await assert.rejects(stat(path), { code: 'ENOENT' });
				f.finishModels();
				await f.wait(run, 'completed');
				assert.equal((await children(f, run, 1))[0].status, 'cancelled');
				const operations = f
					.operations(child)
					.filter((row) => row.label === 'nexus.tools.remote.file_write' || row.label === 'remote.write');
				assert.equal(operations.length, 2);
				assert.ok(operations.every((tool) => tool.state === 'cancelled'));
				const packageCall = operations.find((row) => row.kind === 'tool');
				assert.equal(packageCall.label, 'nexus.tools.remote.file_write');
				const hostCall = operations.find((row) => row.label === 'remote.write');
				assert.equal(hostCall.parent_id, packageCall.id);
				assert.ok(hostCall.revision >= 2, 'The accepted operation has an immutable terminal receipt');
				const db = new DatabaseSync(join(directory, 'state.db'), { readOnly: true });
				try {
					assert.equal(
						db
							.prepare('SELECT COUNT(*) AS count FROM agent_operation_authorities WHERE operation_id=?')
							.get(hostCall.id).count,
						0,
						'An unapproved write never commits dispatch authority',
					);
					assert.equal(
						db
							.prepare('SELECT COUNT(*) AS count FROM agent_operation_authorities WHERE operation_id=?')
							.get(packageCall.id).count,
						1,
						'The plugin invocation is independently authorized',
					);
				} finally {
					db.close();
				}
			},
		);
		await scenario(
			'mailbox observation stays passive and model consume plus fact CAS persist',
			async (f, directory, releases) => {
				let release;
				const gate = new Promise((resolve) => {
					release = resolve;
				});
				releases.push(release);
				const objective = f.program('mailbox child', async (results) => {
					await gate;
					switch (results.length) {
						case 0:
							return { name: 'collaboration_message_read', input: { after: 0, limit: 4 } };
						case 1:
							assert.equal(results[0].messages[0].body, 'untrusted message');
							assert.equal(results[0].consumedThrough, 0);
							return {
								name: 'collaboration_message_consume',
								input: { through: results[0].nextCursor, expectedConsumed: 0 },
							};
						case 2:
							assert.equal(results[1].consumedThrough, 1);
							return {
								name: 'collaboration_fact_write',
								input: { key: 'handoff', value: 'unverified fact', expectedVersion: 0 },
							};
						case 3:
							assert.equal(results[2].fact.version, 1);
							return { name: 'collaboration_fact_read', input: { key: 'handoff' } };
						default:
							assert.equal(results[3].fact.value, 'unverified fact');
							return {};
					}
				});
				const run = await f.start('mailbox parent', (results) => {
					if (!results.length) {
						return delegate(objective);
					}
					if (results.length === 1) {
						return {
							name: 'collaboration_message_send',
							input: { recipientId: results[0].id, body: 'untrusted message', ttlSeconds: 60 },
						};
					}
					return { hold: true };
				});
				await f.approve(await f.approval(run, 'collaboration_delegate'));
				await f.approve(await f.approval(run, 'collaboration_message_send'));
				const [child] = await children(f, run, 1);
				const endpoint = childPath(f, run) + '/' + child.id + '/messages';
				const metadata = await until(
					async () => expectStatus(await f.api('GET', endpoint), 200),
					(value) => value.items.length === 1,
					'Message committed',
				);
				assert.equal(metadata.items[0].bodyBytes, Buffer.byteLength('untrusted message'));
				assert.equal(metadata.items[0].senderId, run.id);
				assert.ok(!JSON.stringify(metadata).includes('untrusted message'));
				assert.deepEqual(expectStatus(await f.api('GET', endpoint), 200), metadata);
				release();
				await f.approve(await f.approval(child, 'collaboration_message_consume'));
				await f.approve(await f.approval(child, 'collaboration_fact_write'));
				await f.wait(child, 'completed');
				f.finishModels();
				await f.wait(run, 'completed');
				completedPackageCalls(f, directory, child, [
					['collaboration_message_read', 'collaboration.readMessages'],
					['collaboration_message_consume', 'collaboration.consumeMessages'],
					['collaboration_fact_write', 'collaboration.writeFact'],
					['collaboration_fact_read', 'collaboration.readFact'],
				]);
			},
		);
		await scenario(
			'Child Job uncertainty settles the waiting Root without losing shutdown evidence',
			async (f, directory, releases, cleanup) => {
				await f.grants(['app.intents.exchange', 'shell.execute']);
				const completed = join(directory, 'producer-stopped');
				const started = join(directory, 'producer-started');

				async function fileExists(path) {
					try {
						await stat(path);
						return true;
					} catch (error) {
						if (error.code === 'ENOENT') {
							return false;
						}
						throw error;
					}
				}

				const objective = f.program('background child', async (results) => {
					if (results.length) {
						await until(() => fileExists(started), Boolean, 'Actual Child command dispatch');
						return {};
					}
					return {
						name: 'shell_execute',
						input: {
							connectionId: f.connectionId,
							mode: 'background',
							commands: [
								posixCommand([
									process.execPath,
									'-e',
									`process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'started');setTimeout(()=>fs.writeFileSync(${JSON.stringify(completed)},'done'),3000)`,
								]),
							],
						},
					};
				});
				const run = await f.start('waiting parent', (results) =>
					results.length ? {} : delegate(objective, { profile: 'worker', targets: [String(f.connectionId)] }),
				);
				await f.approve(await f.approval(run, 'collaboration_delegate'));
				const [child] = await children(f, run, 1);
				const approval = await f.approval(child, 'shell_execute');
				await until(
					async () => f.calls,
					(calls) => calls.filter((call) => call.key !== objective).length === 3,
					'Parent final response',
				);
				cleanup.unknown = true;
				await f.approve(approval);
				try {
					await f.wait(run, 'unknown');
					await f.wait(child, 'cancelled');
					assert.equal(f.rows('agent_tool_jobs', child)[0].state, 'unknown');
				} finally {
					await until(
						async () => {
							try {
								return await readFile(completed, 'utf8');
							} catch (error) {
								if (error.code === 'ENOENT') {
									return null;
								}
								throw error;
							}
						},
						(value) => value === 'done',
						'Independent producer completion',
					);
				}
			},
		);
		await scenario(
			'missing collaboration grant refuses delegation before approval or Child creation',
			async (f) => {
				await f.grants(['file.read', 'app.intents.exchange']);
				let forbiddenName;
				const probe = await f.start('capture actual package delegate before revocation', (_results, body) => {
					forbiddenName = fixtureToolName(body, 'collaboration_delegate');
					return {};
				});
				await f.wait(probe, 'completed');
				const baseline = f.calls.length;
				await f.grants(['file.read']);
				const objective = f.program('unauthorized child', () => assert.fail('Unauthorized Child dispatched'));
				const run = await f.start('no collaboration grant', () => ({
					...delegate(objective),
					name: rawToolName(forbiddenName),
				}));
				await f.wait(run, 'unknown');
				assert.equal(findFixtureTool(f.calls.at(-1).body, 'collaboration_delegate'), undefined);
				assert.deepEqual(await children(f, run, 0), []);
				assert.equal(f.calls.length, baseline + 2);
				assert.deepEqual(await listAgentApprovalHistory(f.api, f.appId, run.id), []);
			},
		);
		await scenario('join timeout leaves the Child running until an explicit Root cancel', async (f) => {
			const objective = f.program('join waiting child', () => ({ hold: true }));
			const run = await f.start('bounded join', (results) => {
				if (!results.length) {
					return delegate(objective);
				}
				if (results.length === 1) {
					return {
						name: 'collaboration_join',
						input: { childIds: [results[0].id], mode: 'any', waitSeconds: 1 },
					};
				}
				assert.equal(results[1].ready, false);
				assert.equal(results[1].children[0].status, 'running');
				return { hold: true };
			});
			await f.approve(await f.approval(run, 'collaboration_delegate'));
			await until(
				async () => f.calls,
				(calls) => calls.filter((call) => call.key !== objective).length === 4,
				'Join timeout delivered',
			);
			assert.equal((await children(f, run, 1))[0].status, 'running');
			await f.cancel(run);
			await f.wait(run, 'cancelled');
			assert.equal((await children(f, run, 1))[0].status, 'cancelled');
		});
		await scenario(
			'model list/cancel keeps independent control approval and family ownership',
			async (f, directory, releases, cleanup) => {
				const objective = f.program('model cancelled child', () => ({ hold: true }));
				const run = await f.start('model family control', (results) => {
					switch (results.length) {
						case 0:
							return delegate(objective);
						case 1:
							return { name: 'collaboration_list', input: {} };
						case 2:
							assert.equal(results[1].children[0].id, results[0].id);
							return { name: 'collaboration_cancel', input: { childIds: [results[0].id] } };
						default:
							assert.equal(results[2].children[0].status, 'cancelled');
							return {};
					}
				});
				await f.approve(await f.approval(run, 'collaboration_delegate'));
				const approval = await f.approval(run, 'collaboration_cancel');
				assert.equal(approval.risk, 'control');
				assert.equal((await children(f, run, 1))[0].status, 'running');
				await f.approve(approval);
				await f.wait(run, 'completed');
				assert.equal((await children(f, run, 1))[0].status, 'cancelled');
				completedPackageCalls(f, directory, run, [
					['collaboration_delegate', 'collaboration.delegate'],
					['collaboration_list', 'collaboration.list'],
					['collaboration_cancel', 'collaboration.cancel'],
				]);
			},
		);
	} finally {
		if (sshd) {
			await sshd.close();
		}
	}
});
