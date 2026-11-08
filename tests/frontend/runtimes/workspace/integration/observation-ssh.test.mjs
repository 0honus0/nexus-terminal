import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { openWorkspaceApplication } from '../../../../support/protocols/frontend-workspace.mjs';
import { openDockerContainer } from '../../../../support/protocols/docker-fixture.mjs';
import { WorkspaceRuntimeSession } from '../../../../../packages/frontend/src/runtimes/workspace/session/workspaceRuntimeSession.ts';
import { systemOverviewApi } from '../../../../../packages/frontend/src/features/system-overview/api/system-overview-api.ts';
import { connectionsApi } from '../../../../../packages/frontend/src/features/connections/api/connections-api.ts';

afterEach(() => vi.unstubAllGlobals());

test('real SSH observation preserves host fallback, metrics, Docker actions and subscription retirement', async () => {
	const container = await openDockerContainer();
	let fixture;
	try {
		fixture = await openWorkspaceApplication();
		const { target, key, ssh } = fixture;
		const containerId = container.id;
		const imported = await connectionsApi.importMany([
			{
				connection: {
					name: 'Unavailable same-host identity',
					type: 'SSH',
					host: '127.0.0.1',
					port: ssh.port,
					username: 'nexus-invalid-fixture',
					route: 'direct',
					proxyId: null,
					tagIds: [],
					jumpIds: [],
					notes: null,
				},
				credential: { kind: 'ssh_key', sshKeyId: key.id },
			},
		]);
		assert.equal(imported[0].status, 'ok');
		const unavailableTarget = await connectionsApi.get(imported[0].id);
		const session = new WorkspaceRuntimeSession(target);
		session.adapters.terminal.onOutput(({ consumed }) => consumed?.());
		const checks = [];

		const expect = (value, name) => {
			if (!value) {
				throw Error(name);
			}
			checks.push(name);
		};

		const wait = async (check) => {
			const end = performance.now() + 60000;
			while (!check()) {
				if (performance.now() > end) {
					throw Error('Real observation condition timeout');
				}
				await new Promise((resolve) => setTimeout(resolve, 30));
			}
		};

		const find = () => session.dockerController.containers.value.find((row) => row.id === containerId);

		try {
			const beforeOverview = await connectionsApi.get(target.id);
			const snapshot = await systemOverviewApi.ssh(unavailableTarget);
			expect(
				snapshot.state === 'ready' &&
					snapshot.connectionId === target.id &&
					snapshot.username === target.username,
				'real resource HTTP falls back from rejected SSH identity to same-host connection',
			);
			expect(
				snapshot.status.cpuPercent !== undefined &&
					snapshot.status.memTotal > 0 &&
					snapshot.checkedAt > 1700000000000,
				'real resource HTTP returns actual Linux metrics and millisecond sample time',
			);
			const cached = await systemOverviewApi.ssh(target);
			expect(cached.checkedAt === snapshot.checkedAt, 'same-host resource HTTP reuses current server cache');
			expect(
				(await connectionsApi.get(target.id)).lastConnectedAt === beforeOverview.lastConnectedAt,
				'background resource collection does not change recent connection time',
			);
			session.statusController.activate();
			session.dockerController.setIntervalSeconds(86400);
			session.dockerController.activate();
			await session.connect();
			await wait(() => session.statusController.current.value !== null);
			const sample = session.statusController.current.value;
			expect(
				Number.isFinite(sample.timestamp) && sample.timestamp > 1700000000000,
				'real status timestamp is Unix milliseconds',
			);
			expect(
				sample.cpuPercent !== undefined && sample.memUsed !== undefined,
				'real Linux sample traverses Shared to application state',
			);
			expect(session.statusController.history.value.cpu.length > 0, 'real subscription updates bounded history');
			await session.dockerController.refresh();
			expect(
				session.dockerController.available.value && find()?.state === 'created',
				'real Docker list reaches formal controller',
			);
			expect(
				typeof find()?.labels === 'string' && find().labels.includes('nexus.f1=observation'),
				'real Docker labels preserve native representation',
			);
			await session.dockerController.command(containerId, 'start');
			expect(
				find()?.state === 'running' && !session.dockerController.commandPending.value,
				'real start confirmed and current state refreshed',
			);
			const stats = await session.adapters.docker.getStats(containerId);
			expect(
				stats !== null && (stats.id === containerId || stats.id === containerId.slice(0, 12)),
				'real stats verifies requested full/short identifier',
			);
			await session.dockerController.command(containerId, 'restart');
			expect(find()?.state === 'running', 'real restart confirmed');
			await session.dockerController.command(containerId, 'stop');
			expect(find()?.state === 'exited', 'real stop confirmed');
			await session.dockerController.command(containerId, 'remove');
			expect(!find() && !session.dockerController.commandBlocked.value, 'real remove confirmed without unknown');
			session.statusController.deactivate();
			await new Promise((resolve) => setTimeout(resolve, 100));
			const sequence = session.statusController.history.value.cpu.length;
			await new Promise((resolve) => setTimeout(resolve, 3500));
			expect(
				session.statusController.history.value.cpu.length > sequence,
				'short deactivation preserves the documented subscription grace period',
			);
			// The old script expected immediate deactivation, predating the documented
			// 30s tab-switch grace. Its actual stop-delivery assertion belongs to disposal;
			// the grace boundary itself is covered with the controller's virtual clock.
			session.statusController.dispose();
			const retiredSequence = session.statusController.history.value.cpu.length;
			await new Promise((resolve) => setTimeout(resolve, 3500));
			expect(
				session.statusController.history.value.cpu.length === retiredSequence,
				'disposal stops original real status delivery',
			);
			expect((await session.close()) === 'closed', 'real workspace closes after observation cleanup');
			assert.equal(checks.length, 17);
		} finally {
			await session.dispose();
		}
		assert.equal(
			await container.docker('ps', '-a', '--filter', 'id=' + containerId, '--format', '{{.ID}}'),
			'',
			'real container removed on daemon',
		);
	} finally {
		const results = await Promise.allSettled([fixture?.close(), container.close()]);
		const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
		if (failures.length) throw new AggregateError(failures, 'Observation fixture cleanup failed');
	}
});
