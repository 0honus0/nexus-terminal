import { posixCommand } from '../../../../support/posix-command.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { PosixCommandAdapter } from '../../../../../packages/backend/dist/platform/commands/adapters/posix-command.js';
import { MachineDispatchFailure } from '../../../../../packages/backend/dist/platform/ssh/ssh-port.js';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

await test(
	'Shell yield: an unknown channel outcome releases a readable that never ends',
	{ timeout: 1000 },
	async (t) => {
		const readable = new PassThrough();
		const stderrReadable = new PassThrough();
		t.after(() => stderrReadable.destroy());
		t.after(() => readable.destroy());
		let settle;
		const outcome = new Promise((resolve) => {
			settle = resolve;
		});

		let closed = 0;
		const result = new PosixCommandAdapter().executeBatch(
			async () => ({
				readable,
				stderrReadable,
				outcome,

				close: () => {
					closed++;
				},
			}),
			[{ kind: 'shell', script: 'ignored-by-controlled-channel' }],
			null,
			'stop',
			{ timeoutMs: 10000, maxOutputBytes: 1024 },
		);
		settle({ status: 'unknown', reason: 'cancelled' });
		await assert.rejects(result, (error) => error instanceof MachineDispatchFailure && error.outcome === 'unknown');
		assert.equal(readable.readableEnded, false);
		assert.equal(readable.listenerCount('data'), 0);
		assert.equal(readable.listenerCount('end'), 0);
		assert.equal(readable.listenerCount('error'), 0);
		assert.equal(stderrReadable.listenerCount('data'), 0);
		assert.equal(stderrReadable.listenerCount('end'), 0);
		assert.equal(closed, 1);
	},
);

// Only model responses are scripted. HTTP, governance, SQLite, Job/Run owners and SSH are real.
await test('Shell yield policy and mutation admission', async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-agent-shell-yield-'));
	const sshd = await openSshd(root);
	t.after(() => sshd.close());
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, { timeout: 120000 }, async (subtest) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const fixture = await openAgentExecution(directory, sshd, {
				discover: 'shell_execute shell_job_control tool_result_read',
				signal: subtest.signal,
			});
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
		input: { connectionId: f.connectionId, action: 'wait', waitSeconds: 30, jobIds: [jobId] },
	});

	const result = (f, run, name) => {
		const operation = f.operations(run).findLast((row) => row.label === 'nexus.tools.remote.' + name);
		assert.ok(operation);
		return {
			operation,
			value:
				operation.state === 'completed'
					? JSON.parse(f.content(JSON.parse(operation.result_json).content))
					: { failureCode: operation.failure_code },
		};
	};

	for (const mode of ['foreground', 'background']) {
		await scenario(mode + ' exceeds tool wait budget, waits repeatedly and executes once', async (f, directory) => {
			await settings(f, { toolTimeoutSeconds: 1 });
			const effect = join(directory, 'single-effect');
			const gate = join(directory, 'release-after-waits');
			let completedWaits = 0;
			const run = await f.start(mode + ' yield', async (results) => {
				if (!results.length) {
					return shell(f, {
						mode,
						commands: [
							`printf x >> '${effect}'; while [ ! -f '${gate}' ]; do sleep 0.05; done; printf finished`,
						],
					});
				}
				const latest = results.at(-1).jobs?.[0] ?? results.at(-1);
				assert.equal(latest.jobId, results[0].jobId);
				assert.equal(
					f.operations(run).find((row) => row.label === 'nexus.tools.remote.shell_execute')?.state,
					'completed',
					'the original Job continues after its successful plugin dispatch',
				);
				if (results.length > 1 && completedWaits < 2) {
					assert.ok(['queued', 'dispatched'].includes(latest.state));
					completedWaits++;
					if (completedWaits === 2) await writeFile(gate, 'release');
				}
				return latest.state === 'completed' ? {} : wait(f, results[0].jobId);
			});
			try {
				await f.approve(await f.approval(run, 'shell_execute'));
				await f.wait(run, 'completed');
				assert.equal(completedWaits, 2);
				assert.equal(await readFile(effect, 'utf8'), 'x');
				assert.equal(f.rows('agent_tool_jobs', run).length, 1);
				assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'completed');
				const operations = f.operations(run);
				assert.ok(operations.filter((row) => row.label === 'nexus.tools.remote.shell_job_control').length >= 2);
				assert.ok(operations.every((row) => row.state === 'completed'));
				assert.equal(result(f, run, 'shell_job_control').value.jobs[0].result.commands[0].stdout, 'finished');
				assert.deepEqual(expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items, []);
			} finally {
				await writeFile(gate, 'release');
			}
		});
	}

	await scenario('immediate yield returns one queryable Job; fast foreground retains its result shape', async (f) => {
		const run = await f.start('immediate yield', (results) =>
			!results.length
				? shell(f, { yieldSeconds: 0, commands: [posixCommand(['printf', 'hello'])] })
				: (results.at(-1).jobs?.[0] ?? results.at(-1)).state === 'completed'
					? {}
					: wait(f, results[0].jobId),
		);
		await f.approve(await f.approval(run, 'shell_execute'));
		await f.wait(run, 'completed');
		assert.equal(typeof result(f, run, 'shell_execute').value.jobId, 'string');
		const quick = await f.start('fast foreground', (results) =>
			results.length ? {} : shell(f, { commands: ['printf out; printf err >&2; exit 7'] }),
		);
		await f.approve(await f.approval(quick, 'shell_execute'));
		await f.wait(quick, 'completed');
		const quickResult = result(f, quick, 'shell_execute').value;
		assert.deepEqual(quickResult, {
			jobId: f.rows('agent_tool_jobs', quick)[0].id,
			outputRead: { connectionId: f.connectionId, action: 'output', jobIds: [quickResult.jobId], offset: 0 },
			status: 'nonzero',
			commands: [
				{
					index: 0,
					status: 'nonzero',
					exitCode: 7,
					signal: null,
					stdout: 'out',
					stderr: 'err',
					truncated: false,
				},
			],
		});
	});

	await scenario(
		'short live output is readable before completion and byte cursors preserve UTF-8 exactly',
		async (f, directory) => {
			const gate = join(directory, 'release-output');
			const first = '短🙂',
				tail = '尾🙂'.repeat(800);
			let received = '',
				offset = 0,
				observedWhileActive = false;
			const run = await f.start('live output cursor', async (results) => {
				if (!results.length)
					return shell(f, {
						mode: 'background',
						commands: [
							`printf '${first}'; while [ ! -f '${gate}' ]; do sleep 0.05; done; printf '${tail}'`,
						],
					});
				if (results.length > 1) {
					const page = results.at(-1).jobs[0];
					assert.equal(page.offset, offset);
					offset = page.nextOffset;
					received += page.output.map((item) => item.text).join('');
					assert.equal(offset, Buffer.byteLength(received));
					if (received === first && !observedWhileActive) {
						assert.equal(page.complete, false);
						observedWhileActive = true;
						await writeFile(gate, 'release');
					}
					if (page.complete && page.nextOffset === page.capturedBytes) return {};
				}
				await new Promise((resolve) => setTimeout(resolve, 40));
				return {
					name: 'shell_job_control',
					input: { connectionId: f.connectionId, action: 'output', jobIds: [results[0].jobId], offset },
				};
			});
			await f.approve(await f.approval(run, 'shell_execute'));
			await f.wait(run, 'completed');
			assert.equal(observedWhileActive, true);
			assert.equal(received, first + tail);
			assert.equal(f.rows('agent_tool_jobs', run).length, 1);
		},
	);

	await scenario('8 MiB output finishes over real OpenSSH with its complete log intact', async (f, directory) => {
		await settings(f, { maxToolOutputBytes: 4096 });
		let reconstructed = '';
		let captured;
		const run = await f.start('eight MiB output', (results) => {
			if (results.length === 0)
				return shell(f, {
					commands: ["head -c 8388608 /dev/zero | tr '\\000' o", "printf '末尾🙂'; printf '错误🙂' >&2"],
				});
			if (results.length === 1) {
				assert.equal(results[0].kind, 'captured_result_preview');
				captured = results[0].projection;
				assert.ok(captured.text.includes('"jobId":'));
				assert.ok(captured.text.includes('"outputRead":{"connectionId":' + f.connectionId));
				reconstructed = captured.text;
			} else {
				const page = results.at(-1).items[0];
				assert.equal(page.offset, captured.nextOffset);
				assert.equal(page.sha256, captured.sha256);
				reconstructed += page.text;
				captured = page;
			}
			if (captured.nextOffset === null) {
				const receipt = f.operations(run).find((row) => row.label === 'nexus.tools.remote.shell_execute');
				assert.equal(reconstructed, f.content(JSON.parse(receipt.result_json).content));
				assert.equal(JSON.parse(reconstructed).commands[1].status, 'completed');
				return {};
			}
			return {
				name: 'tool_result_read',
				input: {
					items: [
						{
							toolCallId: captured.toolCallId,
							sha256: captured.sha256,
							offset: captured.nextOffset,
							maxBytes: 3072,
						},
					],
				},
			};
		});
		await f.approve(await f.approval(run, 'shell_execute'));
		await f.wait(run, 'completed', 30000);
		const job = f.rows('agent_tool_jobs', run)[0];
		const value = JSON.parse(job.result_text);
		assert.equal(value.status, 'completed');
		assert.equal(value.commands[0].truncated, true);
		assert.equal(value.commands[1].status, 'completed');
		const bytes = await readFile(join(directory, 'tool-logs', job.id + '.log'));
		assert.equal(bytes.length, 8388608 + Buffer.byteLength('末尾🙂错误🙂'));
		assert.equal(bytes.filter((byte) => byte === 111).length, 8388608);
		const text = bytes.toString('utf8');
		assert.ok(text.includes('末尾🙂'));
		assert.ok(text.includes('错误🙂'));
	});

	await scenario('complete large stdout/stderr and later commands are paged without replay', async (f, directory) => {
		const expected = ['o'.repeat(40000), '错🙂'.repeat(2000), 'tail🙂'];
		const received = ['', '', ''];
		let offset = 0;
		const effect = join(directory, 'once');
		const run = await f.start('complete command output', (results) => {
			if (!results.length)
				return shell(f, {
					commands: [
						`printf x >> '${effect}'; awk 'BEGIN { for(i=0;i<40000;i++) printf "o"; for(i=0;i<2000;i++) printf "错🙂" > "/dev/stderr" }'`,
						"printf 'tail🙂'",
					],
				});
			if (results.length > 1) {
				const page = results.at(-1).jobs[0];
				assert.equal(page.available, true);
				assert.equal(page.offset, offset);
				for (const item of page.output)
					received[item.commandIndex === 1 ? 2 : item.stream === 'stderr' ? 1 : 0] += item.text;
				offset = page.nextOffset;
				if (page.complete && offset === page.capturedBytes) return {};
			}
			return {
				name: 'shell_job_control',
				input: { connectionId: f.connectionId, action: 'output', jobIds: [results[0].jobId], offset },
			};
		});
		await f.approve(await f.approval(run, 'shell_execute'));
		await f.wait(run, 'completed', 30000);
		assert.deepEqual(received, expected);
		assert.equal(await readFile(effect, 'utf8'), 'x');
		const job = f.rows('agent_tool_jobs', run)[0];
		assert.equal(JSON.parse(job.result_text).commands[0].truncated, true);
		assert.ok(offset > 32 * 1024);
		await f.restart();
		const { NativeTextLogStore } =
			await import('../../../../../packages/backend/dist/platform/blobs/adapters/native-text-log-store.js');
		const store = await NativeTextLogStore.open(join(directory, 'tool-logs'));
		assert.equal((await store.read(job.id, 0, 4096)).totalBytes, offset);
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
							mode: 'background',
							commands: [
								`trap '' HUP TERM; printf x > '${effect}'; while [ ! -f '${gate}' ]; do sleep 0.05; done; printf done > '${finished}'`,
							],
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
					const next = await f.start(code, (results) =>
						results.length ? {} : shell(f, { commands: [posixCommand(['touch', forbiddenEffect])] }),
					);
					await f.approve(await f.approval(next, 'shell_execute'));
					await f.wait(next, 'completed');
					const entry = result(f, next, 'shell_execute');
					assert.equal(entry.operation.state, 'failed');
					assert.equal(entry.value.failureCode, code);
					assert.equal(f.rows('agent_tool_jobs', next)[0].state, 'failed');
					await assert.rejects(stat(forbiddenEffect), { code: 'ENOENT' });
				}

				await refused('mutation_busy');
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
				await refused('mutation_blocked');
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
			const gate = join(directory, 'release-revoked-process');
			const run = await f.start('yield then revoke', (results) =>
				results.length
					? { hold: true }
					: shell(f, {
							yieldSeconds: 0,
							commands: [
								`trap '' HUP TERM; printf x > '${effect}'; while [ ! -f '${gate}' ]; do sleep 0.05; done; printf done > '${finished}'`,
							],
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
					'Yielded process started',
				);
				await until(
					() => f.calls.length,
					(count) => count === 3,
					'Model received same Job',
				);
				assert.equal(
					f.operations(run).find((row) => row.label === 'nexus.tools.remote.shell_execute')?.state,
					'completed',
					'App grants are revoked after the original plugin dispatch completed',
				);
				assert.equal(f.rows('agent_tool_jobs', run)[0]?.state, 'dispatched');
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
					'Revocation fixture process independently ended',
				);
			}
		},
	);
});
