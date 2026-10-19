import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';
import { ToolService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-service.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
} from '../../../packages/backend/dist/modules/agent/agent-failure.js';

await test('B10 resource drain preserves effect uncertainty and independent storage failures', async () => {
	const effect = new ToolExecutionUnknown();
	const cleanup = new ToolCleanupFailure();
	const storage = new AgentFailure('storage_unavailable');
	for (const failures of [[effect], [new AggregateError([effect, cleanup])], [effect, storage]]) {
		const visited = [];
		const resources = failures.map((failure, index) => () => {
			visited.push(index);
			throw failure;
		});
		resources.push(() => visited.push('released'));
		await assert.rejects(
			ToolService.prototype.drainRun.call(
				{
					integrations: { drainRun: resources[0] },
					jobs: { drain: resources[1] },
					browser: { drainRun: resources[2] ?? (() => visited.push('browser')) },
				},
				{ userId: 1, appId: 'app', runId: 'run' },
			),
			(error) => {
				if (failures.includes(storage)) {
					assert.ok(error instanceof AggregateError);
					assert.deepEqual(error.errors, failures);
				} else {
					assert.ok(error instanceof ToolExecutionUnknown);
					assert.equal(error instanceof ToolCleanupFailure, failures[0] instanceof AggregateError);
					assert.deepEqual(error.cause.errors, failures);
				}
				return true;
			},
		);
		assert.ok(visited.includes('released'));
		assert.equal(visited.length, 3);
	}
});

await test('B10 actual Agent Shell and background Job lifecycles', { timeout: 60000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-b10-shell-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const fixture = await openAgentExecution(directory, sshd);
			const cleanup = { unknown: false };
			scenario.after(() => fixture.close(cleanup));
			await work(fixture, directory, cleanup);
		});
	}

	function shell(fixture, input) {
		return { name: 'shell_execute', input: { connectionId: fixture.connectionId, ...input } };
	}

	function result(fixture, run, name) {
		const operation = fixture.rows('agent_run_tools', run).findLast((row) => row.tool_name === name);
		assert.ok(operation, 'Expected durable tool operation');
		return { operation, value: operation.result_text === null ? null : JSON.parse(operation.result_text) };
	}

	async function heldProcess(directory) {
		const pidFile = join(directory, 'process.pid');
		const gate = join(directory, 'release');
		const effect = join(directory, 'effect');
		const code = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(effect)},'started');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){clearInterval(timer);process.stdout.write('released');}},25);`;
		return {
			input: { kind: 'argv', argv: [process.execPath, '-e', code] },

			async started() {
				return until(
					async () => {
						try {
							return Number(await readFile(pidFile, 'utf8'));
						} catch (error) {
							if (error.code === 'ENOENT') {
								return null;
							}
							throw error;
						}
					},
					(pid) => Number.isSafeInteger(pid) && pid > 1,
					'SSH fixture process started',
				);
			},

			async stop() {
				await writeFile(gate, 'release');
				const pid = await this.started();
				await until(
					async () => {
						try {
							const status = await readFile('/proc/' + pid + '/stat', 'utf8');
							return status.slice(status.lastIndexOf(')') + 2).startsWith('Z');
						} catch (error) {
							if (error.code === 'ENOENT' || error.code === 'ESRCH') {
								return true;
							}
							throw error;
						}
					},
					Boolean,
					'SSH fixture process ended',
				);
			},
		};
	}

	try {
		sshd = await openSshd(root);
		await scenario(
			'argv preserves literal metacharacters and cwd without creating injected files',
			async (f, directory) => {
				const injected = join(directory, 'injected');
				const text = `a'; touch ${injected}; $(touch ${injected})`;
				const run = await f.start('argv literal', (results) =>
					results.length
						? {}
						: shell(f, {
								kind: 'argv',
								argv: ['printf', '%s', text],
								cwd: directory,
							}),
				);
				await f.approve(await f.approval(run, 'shell_execute'));
				await f.wait(run, 'completed');
				assert.equal(result(f, run, 'shell_execute').value.stdout, text);
				await assert.rejects(stat(injected), { code: 'ENOENT' });
			},
		);

		await scenario('nonzero exit is a confirmed result with separate stdout and stderr', async (f) => {
			const run = await f.start('nonzero', (results) =>
				results.length
					? {}
					: shell(f, {
							kind: 'shell',
							script: 'printf out; printf err >&2; exit 7',
						}),
			);
			await f.approve(await f.approval(run, 'shell_execute'));
			await f.wait(run, 'completed');
			assert.deepEqual(result(f, run, 'shell_execute').value, {
				status: 'nonzero',
				exitCode: 7,
				signal: null,
				stdout: 'out',
				stderr: 'err',
				truncated: false,
			});
		});

		await scenario('large command output stays captured and previewed without rerunning the command', async (f) => {
			const run = await f.start('large output', (results) =>
				results.length
					? {}
					: shell(f, {
							kind: 'argv',
							argv: [process.execPath, '-e', "process.stdout.write('x'.repeat(40000))"],
						}),
			);
			await f.approve(await f.approval(run, 'shell_execute'));
			await f.wait(run, 'completed');
			const value = result(f, run, 'shell_execute').value;
			assert.equal(value.truncated, true);
			assert.equal(Buffer.byteLength(value.stdout), 32768);
			assert.equal(f.calls.length, 2);
			assert.equal(
				JSON.parse(f.calls[1].body.messages.find((message) => message.role === 'tool').content).kind,
				'captured_result_preview',
			);
		});

		await scenario(
			'background list, status and wait preserve identity and a real successful result',
			async (f, directory) => {
				const effect = join(directory, 'background-effect');
				const run = await f.start('background normal', (results) => {
					if (!results.length) {
						return shell(f, {
							kind: 'argv',
							mode: 'background',
							argv: [
								process.execPath,
								'-e',
								`setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(effect)},'done');process.stdout.write('job complete');},200)`,
							],
						});
					}
					const actions = ['list', 'status', 'wait'];
					const action = actions[results.length - 1];
					return action
						? {
								name: 'shell_job_control',
								input: {
									connectionId: f.connectionId,
									action,
									...(action === 'list' ? {} : { jobId: results[0].jobId }),
									...(action === 'wait' ? { waitSeconds: 3 } : {}),
								},
							}
						: {};
				});
				await f.approve(await f.approval(run, 'shell_execute'));
				await f.wait(run, 'completed');
				assert.equal(await readFile(effect, 'utf8'), 'done');
				const job = f.rows('agent_tool_jobs', run)[0];
				assert.equal(job.state, 'completed');
				assert.equal(result(f, run, 'shell_job_control').value.jobId, job.id);
				assert.equal(result(f, run, 'shell_job_control').value.result.stdout, 'job complete');
				const count = f.calls.length;
				await f.restart();
				assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'completed');
				assert.equal(f.calls.length, count);
			},
		);

		await scenario(
			'wait expiry leaves a running Job; Run cancellation preserves unknown and durable recovery',
			async (f, directory, cleanup) => {
				const processFixture = await heldProcess(directory);
				try {
					const run = await f.start('wait then cancel', (results) =>
						!results.length
							? shell(f, { ...processFixture.input, mode: 'background' })
							: results.length === 1
								? {
										name: 'shell_job_control',
										input: {
											connectionId: f.connectionId,
											action: 'wait',
											jobId: results[0].jobId,
											waitSeconds: 1,
										},
									}
								: { hold: true },
					);
					await f.approve(await f.approval(run, 'shell_execute'));
					await processFixture.started();
					await until(
						() => f.calls.length,
						(count) => count === 3,
						'Wait result reached model',
					);
					assert.equal(result(f, run, 'shell_job_control').value.state, 'dispatched');
					await f.cancel(run);
					await until(
						() => f.rows('agent_tool_jobs', run)[0].state,
						(state) => state === 'unknown',
						'Cancelled dispatched Job unknown',
					);
					cleanup.unknown = true;
					await f.wait(run, 'cancelled');
					assert.equal(result(f, run, 'shell_execute').operation.state, 'completed');
					await processFixture.stop();
					const claims = expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200);
					assert.equal(claims.items.length, 1);
					assert.equal(claims.items[0].state, 'blocked');
					assert.equal(claims.items[0].recoveryAllowed, false);
					const count = f.calls.length;
					await f.restart({ unknown: true });
					cleanup.unknown = false;
					assert.equal(f.calls.length, count);
					assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'unknown');
					const claim = expectStatus(
						await f.api('GET', '/api/v1/remote/mutations/' + claims.items[0].id),
						200,
					);
					assert.equal(claim.recoveryAllowed, true);
					const root = '/api/v1/remote/mutations/' + claim.id;
					expectStatus(
						await f.api('POST', root + '/release', {
							expectedRevision: claim.revision,
							evidenceId: run.id,
							confirmed: true,
						}),
						409,
					);
					const evidence = expectStatus(
						await f.api('POST', root + '/evidence', {
							expectedRevision: claim.revision,
							outcome: 'partially_applied',
							resourcesStopped: true,
							producerStopped: true,
							observedAt: Date.now(),
							note: 'Fixture process exit independently confirmed; initial marker exists.',
						}),
						200,
					);
					const release = {
						expectedRevision: evidence.revision,
						evidenceId: evidence.evidence.at(-1).id,
						confirmed: true,
					};
					assert.equal(expectStatus(await f.api('POST', root + '/release', release), 200).state, 'released');
					expectStatus(await f.api('POST', root + '/release', release), 409);
					await f.wait(run, 'cancelled');
				} finally {
					await processFixture.stop();
				}
			},
		);

		await scenario(
			'foreground cancellation after actual effect never claims the tool was unstarted',
			async (f, directory, cleanup) => {
				const processFixture = await heldProcess(directory);
				try {
					const run = await f.start('foreground cancel', () => shell(f, processFixture.input));
					await f.approve(await f.approval(run, 'shell_execute'));
					await processFixture.started();
					await f.cancel(run);
					await f.wait(run, 'cancelled');
					assert.equal(result(f, run, 'shell_execute').operation.state, 'unknown');
					assert.equal(await readFile(join(directory, 'effect'), 'utf8'), 'started');
					cleanup.unknown = true;
				} finally {
					await processFixture.stop();
				}
			},
		);

		await scenario(
			'explicit Job cancel needs its own control approval and cannot prove rollback',
			async (f, directory, cleanup) => {
				const processFixture = await heldProcess(directory);
				try {
					const run = await f.start('job cancel', (results) =>
						!results.length
							? shell(f, { ...processFixture.input, mode: 'background' })
							: results.length === 1
								? {
										name: 'shell_job_control',
										input: {
											connectionId: f.connectionId,
											action: 'cancel',
											jobId: results[0].jobId,
										},
									}
								: {},
					);
					await f.approve(await f.approval(run, 'shell_execute'));
					await processFixture.started();
					const approval = await f.approval(run, 'shell_job_control');
					assert.equal(approval.inspection.risk, 'control');
					assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'dispatched');
					await f.approve(approval);
					await until(
						() => f.rows('agent_tool_jobs', run)[0].state,
						(state) => state === 'unknown',
						'Job cancel unknown',
					);
					cleanup.unknown = true;
					await f.wait(run, 'unknown');
				} finally {
					await processFixture.stop();
				}
			},
		);

		await scenario(
			'revoking permission while a background process runs fences its result',
			async (f, directory, cleanup) => {
				const processFixture = await heldProcess(directory);
				try {
					const run = await f.start('running revocation', (results) =>
						!results.length ? shell(f, { ...processFixture.input, mode: 'background' }) : { hold: true },
					);
					await f.approve(await f.approval(run, 'shell_execute'));
					await processFixture.started();
					await until(
						() => f.calls.length,
						(count) => count === 2,
						'Held model continuation',
					);
					await f.grants([]);
					await until(
						() => f.rows('agent_tool_jobs', run)[0].state,
						(state) => state === 'unknown',
						'Revoked Job unknown',
					);
					cleanup.unknown = true;
					f.finishModels();
					await f.wait(run, 'unknown');
				} finally {
					await processFixture.stop();
				}
			},
		);

		await scenario(
			'target version change rejects a pending Shell approval before any process starts',
			async (f, directory) => {
				const effect = join(directory, 'must-not-exist');
				const run = await f.start('target revision', () => shell(f, { kind: 'argv', argv: ['touch', effect] }));
				const approval = await f.approval(run, 'shell_execute');
				await f.changeTarget();
				expectStatus(
					await f.api(
						'POST',
						'/api/v1/apps/' + run.appId + '/approvals/' + approval.id + '/resolve',
						{
							decision: 'approved',
							operationHash: approval.operationHash,
							expectedVersion: approval.version,
						},
						{ 'Idempotency-Key': randomUUID() },
					),
					409,
				);
				await f.wait(run, 'failed');
				await assert.rejects(stat(effect), { code: 'ENOENT' });
			},
		);
	} finally {
		if (sshd) {
			await sshd.close();
		}
		await rm(root, { recursive: true, force: true });
	}
});
