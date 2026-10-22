import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';
import { RunExecutionOwner } from '../../../packages/backend/dist/modules/agent/runs/service/run-execution-owner.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
} from '../../../packages/backend/dist/modules/agent/agent-failure.js';

await test('B10 Child waits preserve nested effect failures and independent storage uncertainty', async () => {
	const unknown = new ToolExecutionUnknown();
	const cleanup = new ToolCleanupFailure();
	const storage = new AgentFailure('operation_unknown');
	for (const failures of [[unknown], [new AggregateError([unknown, cleanup])], [unknown, storage]]) {
		let settled = false;
		const tasks = new Map(failures.map((failure, index) => [String(index), { settled: Promise.reject(failure) }]));
		tasks.set('independent', {
			settled: Promise.resolve().then(() => {
				settled = true;
			}),
		});
		await assert.rejects(RunExecutionOwner.prototype.waitChildren.call({ tasks }, [...tasks.keys()]), (error) => {
			assert.equal(settled, true);
			if (failures.includes(storage)) {
				assert.ok(error instanceof AggregateError);
				assert.deepEqual(error.errors, failures);
			} else {
				assert.ok(error instanceof ToolExecutionUnknown);
				assert.equal(error instanceof ToolCleanupFailure, failures[0] instanceof AggregateError);
				assert.deepEqual(error.cause.errors, failures);
			}
			return true;
		});
	}
});

await test('B10 actual Root/Child collaboration ownership', { timeout: 60000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-b10-collaboration-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const f = await openAgentExecution(directory, sshd);
			const releases = [];
			const cleanup = { unknown: false };
			scenario.after(async () => {
				for (const release of releases) {
					release();
				}
				await f.close(cleanup);
			});
			await f.grants(['app.intents.exchange', 'file.read', 'file.write']);
			await work(f, directory, releases, cleanup);
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

	try {
		sshd = await openSshd(root);
		await scenario(
			'delegation inherits tools and budgets while preserving isolated history and safe observation',
			async (f) => {
				const objective = f.program('independent child', (results, body) => {
					assert.equal(results.length, 0);
					assert.equal(body.messages.filter((message) => message.role === 'user').length, 1);
					const names = body.tools.map((tool) => tool.function.name);
					assert.ok(names.includes('file_read'));
					assert.ok(names.includes('file_write'));
					assert.ok(!names.includes('collaboration_delegate'));
					return {};
				});
				const run = await f.start('private parent context', (results) => {
					if (!results.length) {
						return delegate(objective);
					}
					if (results.length === 1) {
						return {
							name: 'collaboration_join',
							input: { childIds: [results[0].id], mode: 'all', waitSeconds: 5 },
						};
					}
					assert.equal(results[1].ready, true);
					assert.equal(results[1].children[0].status, 'completed');
					assert.equal(results[1].children[0].output, 'Fixture finished');
					return {};
				});
				assert.equal((await children(f, run, 0)).length, 0);
				await f.approve(await f.approval(run, 'collaboration_delegate'));
				await f.wait(run, 'completed');
				const [child] = await children(f, run, 1);
				assert.equal(child.status, 'completed');
				assert.equal(child.parentId, run.id);
				assert.equal(child.deadlineAt, run.deadlineAt);
				const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
				assert.equal(
					f.rows('agent_run_children', { id: child.id })[0].max_requests,
					settings.limits.maxModelRequests,
				);
				assert.deepEqual(Object.keys(child).sort(), [
					'deadlineAt',
					'id',
					'parentId',
					'profile',
					'status',
					'version',
				]);
				const call = f.calls.find((value) => value.key === objective);
				assert.ok(call);
				assert.ok(!JSON.stringify(call.body).includes('private parent context'));
				assert.equal(f.calls.length, 4);
				await f.restart();
				assert.equal((await children(f, run, 1))[0].status, 'completed');
				assert.equal(f.calls.length, 4);
			},
		);
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
			'Child cancellation invalidates its own pending write approval and parent success',
			async (f, directory, releases, cleanup) => {
				const unrelated = await f.start('unrelated family', () => ({}));
				await f.wait(unrelated, 'completed');
				const path = join(directory, 'must-not-exist');
				const objective = f.program('worker child', () => ({
					name: 'file_write',
					input: {
						connectionId: f.connectionId,
						path,
						content: 'forbidden after cancel',
						expectedSha256: 'absent',
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
				cleanup.unknown = true;
				f.finishModels();
				await f.wait(run, 'unknown');
				assert.equal((await children(f, run, 1))[0].status, 'cancelled');
				assert.ok(f.rows('agent_run_tools', child).every((tool) => tool.state !== 'completed'));
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
				assert.equal(f.rows('agent_run_tools', child).length, 4);
				assert.ok(f.rows('agent_run_tools', child).every((tool) => tool.state === 'completed'));
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
							kind: 'argv',
							mode: 'background',
							argv: [
								process.execPath,
								'-e',
								`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'started');setTimeout(()=>fs.writeFileSync(${JSON.stringify(completed)},'done'),3000)`,
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
					(calls) => calls.filter((call) => call.key !== objective).length === 2,
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
				await f.grants(['file.read']);
				const objective = f.program('unauthorized child', () => assert.fail('Unauthorized Child dispatched'));
				const run = await f.start('no collaboration grant', () => delegate(objective));
				await f.wait(run, 'failed');
				assert.deepEqual(await children(f, run, 0), []);
				assert.equal(f.calls.length, 1);
				assert.deepEqual(
					expectStatus(await f.api('GET', '/api/v1/apps/' + f.appId + '/runs/' + run.id + '/approvals'), 200),
					[],
				);
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
				(calls) => calls.filter((call) => call.key !== objective).length === 3,
				'Join timeout delivered',
			);
			assert.equal((await children(f, run, 1))[0].status, 'running');
			await f.cancel(run);
			await f.wait(run, 'cancelled');
			assert.equal((await children(f, run, 1))[0].status, 'cancelled');
		});
		await scenario('stale fact CAS keeps the first value and never retries', async (f) => {
			const run = await f.start('fact conflict', (results) => ({
				name: 'collaboration_fact_write',
				input: {
					key: 'same-key',
					value: results.length ? 'must-not-overwrite' : 'first value',
					expectedVersion: 0,
				},
			}));
			await f.approve(await f.approval(run, 'collaboration_fact_write'));
			await f.approve(await f.approval(run, 'collaboration_fact_write'));
			await f.wait(run, 'unknown');
			const tools = f.rows('agent_run_tools', run);
			assert.equal(tools.length, 2);
			assert.equal(tools[0].state, 'completed');
			assert.equal(tools[1].state, 'unknown');
			assert.equal(JSON.parse(tools[0].result_text).fact.value, 'first value');
			assert.deepEqual(
				f.facts(run).map((fact) => ({
					key: fact.fact_key,
					value: fact.value_text,
					version: fact.version,
					authorId: fact.author_id,
				})),
				[{ key: 'same-key', value: 'first value', version: 1, authorId: run.id }],
			);
			assert.equal(f.calls.length, 2);
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
				assert.equal(approval.inspection.risk, 'control');
				assert.equal((await children(f, run, 1))[0].status, 'running');
				await f.approve(approval);
				cleanup.unknown = true;
				await f.wait(run, 'unknown');
				assert.equal((await children(f, run, 1))[0].status, 'cancelled');
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((tool) => tool.state),
					['completed', 'completed', 'completed'],
				);
			},
		);
	} finally {
		if (sshd) {
			await sshd.close();
		}
		await rm(root, { recursive: true, force: true });
	}
});
