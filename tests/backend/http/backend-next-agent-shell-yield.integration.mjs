import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';

// Only model responses are scripted. HTTP, governance, SQLite, Job/Run owners and SSH are real.
await test('Shell yield policy and mutation admission', { timeout: 60000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-agent-shell-yield-'));
	const sshd = await openSshd(root);
	t.after(() => sshd.close());
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, async (subtest) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const fixture = await openAgentExecution(directory, sshd);
			const cleanup = { unknown: false };
			subtest.after(() => fixture.close(cleanup));
			await work(fixture, directory, cleanup);
		});
	}

	async function settings(f, changes) {
		const current = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
		expectStatus(
			await f.api('PUT', '/api/v1/agent/execution-settings', {
				expectedVersion: current.version,
				enabled: true,
				limits: { ...current.limits, ...changes },
			}),
			200,
		);
	}

	const shell = (f, input) => ({ name: 'shell_execute', input: { connectionId: f.connectionId, ...input } });

	const wait = (f, jobId) => ({
		name: 'shell_job_control',
		input: { connectionId: f.connectionId, action: 'wait', jobId, waitSeconds: 30 },
	});

	const result = (f, run, name) => {
		const operation = f.rows('agent_run_tools', run).findLast((row) => row.tool_name === name);
		assert.ok(operation);
		return { operation, value: JSON.parse(operation.result_text) };
	};

	for (const mode of ['foreground', 'background']) {
		await scenario(mode + ' exceeds tool wait budget, waits repeatedly and executes once', async (f, directory) => {
			await settings(f, { toolTimeoutSeconds: 1 });
			const effect = join(directory, 'single-effect');
			const run = await f.start(mode + ' yield', (results) => {
				if (!results.length) {
					return shell(f, {
						kind: 'shell',
						mode,
						script: `printf x >> '${effect}'; sleep 3; printf finished`,
					});
				}
				const latest = results.at(-1);
				assert.equal(latest.jobId, results[0].jobId);
				return latest.state === 'completed' ? {} : wait(f, results[0].jobId);
			});
			await f.approve(await f.approval(run, 'shell_execute'));
			await f.wait(run, 'completed');
			assert.equal(await readFile(effect, 'utf8'), 'x');
			assert.equal(f.rows('agent_tool_jobs', run).length, 1);
			assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'completed');
			const operations = f.rows('agent_run_tools', run);
			assert.ok(operations.filter((row) => row.tool_name === 'shell_job_control').length >= 2);
			assert.ok(operations.every((row) => row.state === 'completed'));
			assert.equal(result(f, run, 'shell_job_control').value.result.stdout, 'finished');
			assert.deepEqual(expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items, []);
		});
	}

	await scenario('immediate yield returns one queryable Job; fast foreground retains its result shape', async (f) => {
		const run = await f.start('immediate yield', (results) =>
			!results.length
				? shell(f, { kind: 'argv', argv: ['printf', 'hello'], yieldSeconds: 0 })
				: results.at(-1).state === 'completed'
					? {}
					: wait(f, results[0].jobId),
		);
		await f.approve(await f.approval(run, 'shell_execute'));
		await f.wait(run, 'completed');
		assert.equal(typeof result(f, run, 'shell_execute').value.jobId, 'string');
		const quick = await f.start('fast foreground', (results) =>
			results.length ? {} : shell(f, { kind: 'shell', script: 'printf out; printf err >&2; exit 7' }),
		);
		await f.approve(await f.approval(quick, 'shell_execute'));
		await f.wait(quick, 'completed');
		assert.deepEqual(result(f, quick, 'shell_execute').value, {
			status: 'nonzero',
			exitCode: 7,
			signal: null,
			stdout: 'out',
			stderr: 'err',
			truncated: false,
		});
	});

	await scenario(
		'held and blocked admission never execute the new command or overwrite original evidence',
		async (f, directory, cleanup) => {
			const gate = join(directory, 'release');
			const effect = join(directory, 'original-started');
			const finished = join(directory, 'original-finished');
			const forbiddenEffect = join(directory, 'must-not-exist');
			const run = await f.start('held mutation', (results) =>
				results.length
					? { hold: true }
					: shell(f, {
							kind: 'shell',
							mode: 'background',
							script: `printf x > '${effect}'; while [ ! -f '${gate}' ]; do sleep 0.05; done; printf done > '${finished}'`,
						}),
			);
			try {
				await f.approve(await f.approval(run, 'shell_execute'));
				await until(
					async () => {
						try {
							return await readFile(effect, 'utf8');
						} catch (error) {
							if (error.code === 'ENOENT') {
								return null;
							}
							throw error;
						}
					},
					(value) => value === 'x',
					'Original command started',
				);
				const claim = expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items[0];
				assert.equal(claim.state, 'held');

				async function refused(code) {
					const next = await f.start(code, () =>
						shell(f, { kind: 'argv', argv: ['touch', forbiddenEffect] }),
					);
					await f.approve(await f.approval(next, 'shell_execute'));
					const view = await f.wait(next, 'failed');
					assert.equal(view.failure.code, code);
					const entry = result(f, next, 'shell_execute');
					assert.equal(entry.operation.state, 'failed');
					assert.equal(entry.value.failureCode, code);
					assert.equal(f.rows('agent_tool_jobs', next)[0].state, 'failed');
					await assert.rejects(stat(forbiddenEffect), { code: 'ENOENT' });
				}

				await refused('tool_machine_busy');
				assert.equal(
					expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items[0].revision,
					claim.revision,
				);
				await f.cancel(run);
				await until(
					() => f.rows('agent_tool_jobs', run)[0].state,
					(state) => state === 'unknown',
					'Original cancellation retains unknown',
				);
				cleanup.unknown = true;
				const blocked = expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items[0];
				assert.equal(blocked.state, 'blocked');
				await refused('tool_machine_blocked');
				assert.deepEqual(expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items, [blocked]);
			} finally {
				await writeFile(gate, 'release');
				await until(
					async () => {
						try {
							return await readFile(finished, 'utf8');
						} catch (error) {
							if (error.code === 'ENOENT') {
								return null;
							}
							throw error;
						}
					},
					(value) => value === 'done',
					'Independent remote process termination',
				);
			}
		},
	);

	await scenario(
		'revocation after foreground yield cancels the same Job without replay',
		async (f, directory, cleanup) => {
			const effect = join(directory, 'revocation-started');
			const finished = join(directory, 'revocation-finished');
			const run = await f.start('yield then revoke', (results) =>
				results.length
					? { hold: true }
					: shell(f, {
							kind: 'shell',
							script: `printf x > '${effect}'; sleep 3; printf done > '${finished}'`,
							yieldSeconds: 0,
						}),
			);
			await f.approve(await f.approval(run, 'shell_execute'));
			await until(
				async () => {
					try {
						return await readFile(effect, 'utf8');
					} catch (error) {
						if (error.code === 'ENOENT') {
							return null;
						}
						throw error;
					}
				},
				(value) => value === 'x',
				'Yielded process started',
			);
			await until(
				() => f.calls.length,
				(count) => count === 2,
				'Model received same Job',
			);
			await f.grants([]);
			await until(
				() => f.rows('agent_tool_jobs', run)[0]?.state,
				(state) => state === 'unknown',
				'Revocation preserves unknown',
			);
			cleanup.unknown = true;
			f.finishModels();
			await f.wait(run, 'unknown');
			assert.equal(f.rows('agent_tool_jobs', run).length, 1);
			assert.equal(await readFile(effect, 'utf8'), 'x');
			await until(
				async () => {
					try {
						return await readFile(finished, 'utf8');
					} catch (error) {
						if (error.code === 'ENOENT') {
							return null;
						}
						throw error;
					}
				},
				(value) => value === 'done',
				'Revocation fixture process independently ended',
			);
		},
	);

	await scenario(
		'original Run deadline still stops yielded execution and preserves unknown',
		async (f, directory, cleanup) => {
			await settings(f, { maxActiveSeconds: 3, toolTimeoutSeconds: 1 });
			const effect = join(directory, 'deadline-started');
			const finished = join(directory, 'deadline-finished');
			const run = await f.start('hard Run deadline', (results) =>
				!results.length
					? shell(f, {
							kind: 'shell',
							script: `printf x > '${effect}'; sleep 4; printf done > '${finished}'`,
							yieldSeconds: 0,
						})
					: wait(f, results[0].jobId),
			);
			await f.approve(await f.approval(run, 'shell_execute'));
			await until(
				() => f.rows('agent_tool_jobs', run)[0]?.state,
				(state) => state === 'unknown',
				'Execution budget preserves unknown',
			);
			cleanup.unknown = true;
			assert.equal(await readFile(effect, 'utf8'), 'x');
			assert.equal(expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items[0].state, 'blocked');
			await until(
				async () => {
					try {
						return await readFile(finished, 'utf8');
					} catch (error) {
						if (error.code === 'ENOENT') {
							return null;
						}
						throw error;
					}
				},
				(value) => value === 'done',
				'Deadline fixture process independently ended',
			);
		},
	);
});
