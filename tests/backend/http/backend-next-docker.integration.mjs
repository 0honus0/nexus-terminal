import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, expectStatus } from '../remote/openssh-fixture.mjs';
import {
	readWorkspaceDockerStatusResponse,
	readWorkspaceDockerStatsResponse,
} from '../../../packages/shared/dist/remote/docker/workspace-codec.js';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 20000 }).trim();

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

await test('B10 actual Docker over ordinary Workspace and governed Agent SSH', { timeout: 180000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-b10-docker-'));
	const containers = new Set();
	let sshd;
	let sequence = 0;

	function create() {
		const id = docker(
			'create',
			'--name',
			'nexus-b10-' + randomUUID(),
			'--label',
			'nexus.b10=docker',
			'--stop-timeout',
			'1',
			'alpine:latest',
			'sh',
			'-c',
			'trap "exit 0" TERM; while :; do sleep 0.1; done',
		);
		assert.match(id, /^[a-f0-9]{64}$/u);
		containers.add(id);
		return id;
	}

	const state = (id) => JSON.parse(docker('inspect', id))[0].State.Status;

	async function scenario(name, work) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const f = await openAgentExecution(directory, sshd);
			scenario.after(() => f.close());
			await f.grants(['machine.docker.manage']);
			await work(f, create(), scenario);
		});
	}

	const inspect = (f, id) => ({
		name: 'machine_docker_inspect',
		input: { connectionId: f.connectionId, containerId: id },
	});

	const control = (f, id, action, fingerprint) => ({
		name: 'machine_docker_control',
		input: {
			connectionId: f.connectionId,
			containerId: id,
			action,
			expectedFingerprint: fingerprint,
		},
	});

	try {
		docker('info', '--format', '{{.ServerVersion}}');
		sshd = await openSshd(root);
		await scenario(
			'Workspace status, real samples, all four actions and strict input rejection',
			async (f, id, nested) => {
				const ws = await f.openWorkspace();
				try {
					success(
						await ws.call('workspace.connect', {
							workspaceId: randomUUID(),
							connectionId: f.connectionId,
							viewport: { columns: 100, rows: 30 },
						}),
					);
					await nested.test('stopped container has native string labels and null sample', async () => {
						const status = readWorkspaceDockerStatusResponse(success(await ws.call('docker.status', {})));
						assert.equal(status.available, true);
						const row = status.containers.find((value) => value.id === id);
						assert.ok(row);
						assert.equal(row.state, 'created');
						assert.equal(typeof row.labels, 'string');
						assert.ok(row.labels.includes('nexus.b10=docker'));
						assert.equal(row.stats, null);
					});
					await nested.test(
						'start obtains an actual sample and confirms matching container identity',
						async () => {
							success(await ws.call('docker.command', { containerId: id, command: 'start' }));
							assert.equal(state(id), 'running');
							const stats = readWorkspaceDockerStatsResponse(
								success(await ws.call('docker.stats', { containerId: id })),
							);
							assert.ok(stats);
							assert.ok(id.startsWith(stats.id));
							assert.match(stats.cpuPercent, /%$/u);
							assert.match(stats.memoryUsage, /\//u);
						},
					);
					await nested.test(
						'unknown fields, shell syntax and invalid actions cannot mutate container',
						async () => {
							for (const payload of [
								{ containerId: id, command: 'pause' },
								{ containerId: id + ';true', command: 'remove' },
								{ containerId: id, command: 'remove', unexpected: true },
							])
								assert.equal((await ws.call('docker.command', payload)).ok, false);
							assert.equal(state(id), 'running');
						},
					);
					await nested.test('restart, stop and remove confirm actual daemon state', async () => {
						success(await ws.call('docker.command', { containerId: id, command: 'restart' }));
						assert.equal(state(id), 'running');
						success(await ws.call('docker.command', { containerId: id, command: 'stop' }));
						assert.equal(state(id), 'exited');
						const stoppedStats = readWorkspaceDockerStatsResponse(
							success(await ws.call('docker.stats', { containerId: id })),
						);
						if (stoppedStats !== null) {
							assert.ok(id.startsWith(stoppedStats.id));
							assert.equal(stoppedStats.pids, '0');
						}
						success(await ws.call('docker.command', { containerId: id, command: 'remove' }));
						assert.equal(docker('ps', '-aq', '--no-trunc', '--filter', 'id=' + id), '');
						containers.delete(id);
					});
				} finally {
					await ws.close();
				}
			},
		);
		await scenario(
			'Agent inspect and four independently approved mutations survive restart without replay',
			async (f, id) => {
				const actions = ['start', 'restart', 'stop', 'remove'];
				const run = await f.start('Docker full lifecycle', (results) => {
					if (results.length === actions.length * 2) return {};
					if (results.length % 2 === 0) return inspect(f, id);
					const snapshot = results.at(-1);
					assert.equal(snapshot.containerId, id);
					assert.match(snapshot.fingerprint, /^[a-f0-9]{64}$/u);
					return control(f, id, actions[Math.floor(results.length / 2)], snapshot.fingerprint);
				});
				for (const [index, action] of actions.entries()) {
					const approval = await f.approval(run, 'machine_docker_control');
					assert.equal(state(id), ['created', 'running', 'running', 'exited'][index]);
					assert.equal(approval.inspection.risk, action === 'remove' ? 'destructive' : 'mutate');
					await f.approve(approval);
				}
				await f.wait(run, 'completed');
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((row) => row.state),
					Array(8).fill('completed'),
				);
				assert.equal(docker('ps', '-aq', '--no-trunc', '--filter', 'id=' + id), '');
				containers.delete(id);
				const count = f.calls.length;
				await f.restart();
				await f.wait(run, 'completed');
				assert.equal(f.calls.length, count);
			},
		);
		await scenario('external state drift after inspection prevents approved stale mutation', async (f, id) => {
			const run = await f.start('Docker changed state', (results) =>
				results.length ? control(f, id, 'remove', results[0].fingerprint) : inspect(f, id),
			);
			const approval = await f.approval(run, 'machine_docker_control');
			docker('start', id);
			await f.approve(approval);
			await f.wait(run, 'unknown');
			assert.equal(state(id), 'running');
			assert.equal(f.rows('agent_run_tools', run).at(-1).state, 'unknown');
		});
		await scenario(
			'cancellation while awaiting approval leaves container unchanged and rejects old approval',
			async (f, id) => {
				const run = await f.start('Docker cancelled', (results) =>
					results.length ? control(f, id, 'start', results[0].fingerprint) : inspect(f, id),
				);
				const approval = await f.approval(run, 'machine_docker_control');
				await f.cancel(run);
				await f.wait(run, 'cancelled');
				assert.equal(state(id), 'created');
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
				assert.equal(state(id), 'created');
			},
		);
		await scenario('missing capability never reaches Docker mutation or approval', async (f, id) => {
			await f.grants([]);
			const run = await f.start('Docker denied', () => control(f, id, 'remove', '0'.repeat(64)));
			await f.wait(run, 'failed');
			assert.equal(state(id), 'created');
			assert.deepEqual(
				f.rows('agent_run_tools', run).map((row) => row.state),
				['failed'],
			);
			assert.deepEqual(
				expectStatus(await f.api('GET', '/api/v1/apps/' + f.appId + '/runs/' + run.id + '/approvals'), 200),
				[],
			);
		});
	} finally {
		const failures = [];
		for (const id of containers) {
			try {
				docker('rm', '-f', id);
			} catch (error) {
				failures.push(error);
			}
		}
		for (const close of [() => sshd?.close(), () => rm(root, { recursive: true, force: true })]) {
			try {
				await close();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Docker fixture cleanup failed');
	}
});
