import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';
import { ToolJobModel } from '../../../packages/backend/dist/modules/agent/tools/model/tool-job-model.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';

function contains(error, target) {
	return (
		error === target ||
		(error instanceof AggregateError && error.errors.some((item) => contains(item, target))) ||
		(error instanceof Error && error.cause !== undefined && contains(error.cause, target))
	);
}

// Uses real SSH executables and transport loss. No Run cancellation, model
// response, deadline or restart wakes the failure scenarios.
await test('Job failures stop the owning Run and its waits', { timeout: 60000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-agent-job-failure-'));
	const sshd = await openSshd(root);
	t.after(() => sshd.close());
	let sequence = 0;

	async function scenario(name, work, endpoint = sshd) {
		await t.test(name, async (subtest) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const f = await openAgentExecution(directory, {
				port: endpoint.port,
				user: sshd.user,
				fingerprint: sshd.fingerprint,
				privateKey: sshd.privateKey,
			});
			const cleanup = { unknown: true };
			subtest.after(() => f.close(cleanup));
			await work(f, directory, subtest, cleanup);
		});
	}

	async function executable(directory, subtest) {
		const pidPath = join(directory, 'original.pid');
		const effect = join(directory, 'single-effect');
		const script = join(directory, 'external.mjs');
		const release = join(directory, 'release');
		await writeFile(
			script,
			`import fs from 'node:fs';process.on('SIGHUP',()=>{});fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));fs.appendFileSync(${JSON.stringify(effect)},'x');setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0);},20);`,
		);
		let original;

		async function identity(pid) {
			try {
				const value = await readFile('/proc/' + pid + '/stat', 'utf8');
				const fields = value.slice(value.lastIndexOf(')') + 2).split(' ');
				return { born: fields[19], zombie: fields[0] === 'Z' };
			} catch (error) {
				if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
				throw error;
			}
		}

		async function started() {
			const pid = await until(
				() =>
					readFile(pidPath, 'utf8')
						.then(Number)
						.catch((error) => {
							if (error.code === 'ENOENT') return null;
							throw error;
						}),
				(value) => Number.isSafeInteger(value) && value > 1,
				'Original remote process started',
			);
			const current = await identity(pid);
			assert.ok(current);
			original = { pid, born: current.born };
		}

		async function stop() {
			if (!original) return;
			const current = await identity(original.pid);
			if (current?.born === original.born && !current.zombie) {
				process.kill(original.pid, 'SIGKILL');
			}
		}

		subtest.after(stop);
		return {
			argv: [process.execPath, script],
			effect,
			started,
			stop,

			complete: () => writeFile(release, 'done'),

			async alive() {
				const current = original ? await identity(original.pid) : null;
				return current !== null && current.born === original.born && !current.zombie;
			},
		};
	}

	const sockets = new Set();
	const relay = createServer((client) => {
		const remote = connect({ host: '127.0.0.1', port: sshd.port });
		for (const [socket, peer] of [
			[client, remote],
			[remote, client],
		]) {
			sockets.add(socket);
			socket.on('error', () => peer.destroy());
			socket.once('close', () => {
				sockets.delete(socket);
				peer.destroy();
			});
		}
		client.pipe(remote).pipe(client);
	});
	await new Promise((resolve, reject) => {
		relay.once('error', reject);
		relay.listen(0, '127.0.0.1', resolve);
	});
	const endpoint = relay.address();
	assert.ok(endpoint && typeof endpoint === 'object');
	t.after(async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve, reject) => relay.close((error) => (error ? reject(error) : resolve())));
	});
	await scenario(
		'actual SSH transport loss stops the Run while the remote process is still alive',
		async (f, directory, subtest) => {
			const process = await executable(directory, subtest);
			const run = await f.start('transport loss', (results) =>
				results.length
					? { hold: true }
					: {
							name: 'shell_execute',
							input: {
								connectionId: f.connectionId,
								kind: 'argv',
								argv: process.argv,
								mode: 'background',
							},
						},
			);
			await f.approve(await f.approval(run, 'shell_execute'));
			await process.started();
			await until(
				() => f.heldModelCount,
				(count) => count === 1,
				'Model is waiting before transport loss',
			);
			for (const socket of sockets) socket.destroy();
			const view = await f.wait(run, 'unknown');
			assert.equal(view.failure.code, 'tool_result_unconfirmed');
			assert.equal(await process.alive(), true, 'Local connection loss cannot prove remote execution stopped');
			await until(
				() => f.heldModelCount,
				(count) => count === 0,
				'Transport loss closes model waiting',
			);
			assert.equal(f.calls.length, 2);
			assert.equal(await readFile(process.effect, 'utf8'), 'x');
			assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'unknown');
			assert.equal(expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items[0].state, 'blocked');
			await process.stop();
		},
		endpoint,
	);

	for (const mode of ['foreground', 'poll', 'model', 'approval']) {
		await scenario(
			mode + ': unconfirmed execution ends waiting without replay',
			async (f, directory, subtest, cleanup) => {
				const process = await executable(directory, subtest);
				const forbidden = join(directory, 'unapproved-write');
				const run = await f.start('job failure ' + mode, (results) => {
					if (!results.length)
						return {
							name: 'shell_execute',
							input: {
								connectionId: f.connectionId,
								kind: 'argv',
								argv: process.argv,
								...(mode === 'foreground' ? {} : { mode: 'background' }),
							},
						};
					if (mode === 'approval')
						return {
							name: 'file_write',
							input: {
								connectionId: f.connectionId,
								path: forbidden,
								content: 'never',
								expectedSha256: 'absent',
							},
						};
					if (mode === 'model') return { hold: true };
					return {
						name: 'shell_job_control',
						input: {
							connectionId: f.connectionId,
							action: 'wait',
							jobId: results[0].jobId,
							waitSeconds: 30,
						},
					};
				});
				await f.approve(await f.approval(run, 'shell_execute'));
				await process.started();
				if (mode === 'model')
					await until(
						() => f.heldModelCount,
						(count) => count === 1,
						'Model stream is held',
					);
				if (mode === 'poll')
					await until(
						() =>
							f
								.rows('agent_run_tools', run)
								.some((row) => row.tool_name === 'shell_job_control' && row.state === 'dispatched'),
						Boolean,
						'Job wait is in progress',
					);
				const approval = mode === 'approval' ? await f.approval(run, 'file_write') : null;
				await process.stop();
				const view = await f.wait(run, 'unknown');
				assert.equal(view.failure.code, 'tool_result_unconfirmed');
				assert.equal(view.failure.toolName, 'shell_execute');
				await until(
					() => f.heldModelCount,
					(count) => count === 0,
					'Failed Job closes the model transport',
				);
				assert.equal(f.calls.length, mode === 'foreground' ? 1 : 2, 'No extra model request or polling loop');
				assert.equal(await readFile(process.effect, 'utf8'), 'x');
				assert.equal(f.rows('agent_tool_jobs', run).length, 1);
				assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'unknown');
				assert.ok(
					f.rows('agent_run_tools', run).every((row) => !['inspected', 'dispatched'].includes(row.state)),
				);
				assert.equal(
					expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items[0].state,
					'blocked',
				);
				if (approval) {
					const history = await listAgentApprovalHistory(f.api, f.appId, run.id);
					assert.equal(history.find((item) => item.id === approval.id).status, 'superseded');
					await assert.rejects(stat(forbidden), { code: 'ENOENT' });
				}
				await f.restart({ unknown: true });
				assert.equal((await f.wait(run, 'unknown')).status, 'unknown');
				assert.equal(f.calls.length, mode === 'foreground' ? 1 : 2, 'Restart never replays the Job');
				// The restarted owner has no in-memory failed task; persisted evidence remains.
				cleanup.unknown = false;
			},
		);
	}

	await scenario(
		'untrusted host is a definite failure, never an unknown execution',
		async (f, directory, _subtest, cleanup) => {
			cleanup.unknown = false;
			expectStatus(
				await f.api('POST', '/api/v1/targets/host-keys/remove', { host: '127.0.0.1', port: sshd.port }),
				200,
			);
			const effect = join(directory, 'must-not-execute');
			const run = await f.start('untrusted host', () => ({
				name: 'shell_execute',
				input: { connectionId: f.connectionId, kind: 'argv', argv: ['touch', effect] },
			}));
			await f.approve(await f.approval(run, 'shell_execute'));
			const view = await f.wait(run, 'failed');
			assert.equal(view.failure.code, 'tool_host_untrusted');
			assert.equal(f.rows('agent_run_tools', run)[0].state, 'failed');
			assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'failed');
			assert.deepEqual(JSON.parse(f.rows('agent_tool_jobs', run)[0].result_text), { status: 'not_started' });
			assert.equal(f.calls.length, 1);
			await assert.rejects(stat(effect), { code: 'ENOENT' });
			assert.deepEqual(expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items, []);
		},
	);

	await scenario(
		'Job settlement failure stops a held model without guessing a second write',
		async (f, directory, subtest, cleanup) => {
			const process = await executable(directory, subtest);
			const failure = new AgentFailure('operation_unknown');
			const change = ToolJobModel.prototype.change;
			let attempts = 0;
			subtest.mock.method(ToolJobModel.prototype, 'change', async function (job, state, result) {
				if (state === 'completed') {
					attempts++;
					throw failure;
				}
				return change.call(this, job, state, result);
			});
			const run = await f.start('settlement failure', (results) =>
				results.length
					? { hold: true }
					: {
							name: 'shell_execute',
							input: {
								connectionId: f.connectionId,
								kind: 'argv',
								argv: process.argv,
								mode: 'background',
							},
						},
			);
			await f.approve(await f.approval(run, 'shell_execute'));
			await process.started();
			await until(
				() => f.heldModelCount,
				(count) => count === 1,
				'Held model before settlement fault',
			);
			await process.complete();
			await f.wait(run, 'unknown');
			await until(
				() => f.heldModelCount,
				(count) => count === 0,
				'Settlement failure stopped waiting',
			);
			assert.equal(attempts, 1);
			assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'dispatched', 'No speculative second Job write');
			assert.equal(await readFile(process.effect, 'utf8'), 'x');
			assert.equal(f.calls.length, 2);
			await f.restart({ verifyCloseFailure: (error) => contains(error, failure) });
			cleanup.unknown = false;
			assert.equal(f.rows('agent_tool_jobs', run)[0].state, 'unknown');
			assert.equal((await f.wait(run, 'unknown')).failure.code, 'tool_result_unconfirmed');
		},
	);

	await scenario(
		'Child Job failure stops a held Root and an unrelated Run continues',
		async (f, directory, subtest) => {
			const process = await executable(directory, subtest);
			await f.grants(['app.intents.exchange', 'shell.execute']);
			const objective = f.program('job child', (results) =>
				results.length
					? {
							name: 'shell_job_control',
							input: {
								connectionId: f.connectionId,
								action: 'wait',
								jobId: results[0].jobId,
								waitSeconds: 30,
							},
						}
					: {
							name: 'shell_execute',
							input: {
								connectionId: f.connectionId,
								kind: 'argv',
								argv: process.argv,
								mode: 'background',
							},
						},
			);
			const root = await f.start('held root', (results) =>
				results.length
					? { hold: true }
					: {
							name: 'collaboration_delegate',
							input: {
								profile: 'worker',
								objective,
								dependencyMode: 'success',
								targets: [String(f.connectionId)],
							},
						},
			);
			await f.approve(await f.approval(root, 'collaboration_delegate'));
			const [child] = await until(
				async () =>
					expectStatus(
						await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + root.id + '/subagents'),
						200,
					).items,
				(items) => items.length === 1,
				'Child created',
			);
			await f.approve(await f.approval(child, 'shell_execute'));
			await process.started();
			const unrelated = await f.start('independent held run', () => ({ hold: true }));
			await until(
				() => f.heldModelCount,
				(count) => count === 2,
				'Root and unrelated stream held while Child waits for its Job',
			);
			await process.stop();
			const view = await f.wait(root, 'unknown');
			assert.equal(view.failure.code, 'tool_result_unconfirmed');
			assert.equal(view.failure.toolName, 'shell_execute');
			await until(
				() => f.heldModelCount,
				(count) => count === 1,
				'Only the original family was interrupted',
			);
			assert.equal(f.rows('agent_tool_jobs', child)[0].state, 'unknown');
			assert.equal(await readFile(process.effect, 'utf8'), 'x');
			f.finishModels();
			await f.wait(unrelated, 'completed');
		},
	);

	await scenario('late unknown after user cancellation retains cancelled', async (f, directory, subtest) => {
		const process = await executable(directory, subtest);
		const run = await f.start('cancelled job', (results) =>
			results.length
				? { hold: true }
				: {
						name: 'shell_execute',
						input: { connectionId: f.connectionId, kind: 'argv', argv: process.argv, mode: 'background' },
					},
		);
		await f.approve(await f.approval(run, 'shell_execute'));
		await process.started();
		await until(
			() => f.heldModelCount,
			(count) => count === 1,
			'Model held before explicit cancel',
		);
		await f.cancel(run);
		await until(
			() => f.rows('agent_tool_jobs', run)[0].state,
			(state) => state === 'unknown',
			'Late Job settlement',
		);
		assert.equal((await f.wait(run, 'cancelled')).status, 'cancelled');
		await process.stop();
		assert.equal(f.calls.length, 2);
	});
});
