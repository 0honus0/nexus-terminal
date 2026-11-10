import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSshManagement } from '../../../../support/http/management-fixture.mjs';
import { openSshd } from '../../../../support/protocols/openssh-fixture.mjs';
import {
	readWorkspaceDockerStatusResponse,
	readWorkspaceDockerStatsResponse,
} from '../../../../../packages/shared/dist/remote/docker/workspace-codec.js';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 20000 }).trim();

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

await test('B10 actual Docker over ordinary Workspace', { timeout: 180000 }, async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'nexus-b10-docker-'));
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
			const f = await openSshManagement(directory, sshd);
			scenario.after(() => f.close());
			await work(f, create(), scenario);
		});
	}

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
