import { expect, test } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';
import { closeWebSocket, requestWorkspace, waitForJson } from '../../../../support/protocols/workspace-client';
import { readSettingsResponse } from '../../../../../packages/shared/src/preferences/configuration/http-codec';
import { readRemoteStatusSample } from '../../../../../packages/shared/src/remote/monitoring/http-codec';
import { readWorkspaceDockerStatusResponse } from '../../../../../packages/shared/src/remote/docker/workspace-codec';
import { vi } from 'vitest';
import { setImmediate as nextTurn } from 'node:timers/promises';

test('status monitor and Docker protocols work through the live SSH session', async ({ request, ssh, httpClients }) => {
	await loginAsAdmin(request);
	const settings = await request.get('/api/v1/settings');
	expect(settings.ok()).toBeTruthy();
	const intervalMs =
		readSettingsResponse(await settings.json()).effectiveMonitoring.statusMonitorIntervalSeconds * 1000;
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `status-${crypto.randomUUID()}`);

	try {
		// The controlled SSH peer is a separate process. Only the application's
		// scheduling clock advances; samples still cross the real SSH and WS links.
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldClearNativeTimers: true });
		const startedAt = Date.now();
		const firstStatusPromise = waitForJson(workspace.socket, (message) => message.type === 'status.sample');
		await requestWorkspace(workspace.socket, 'status.start');
		const firstStatus = await firstStatusPromise;
		const firstTimestamp = firstStatus.payload?.timestamp;
		let receivedSecond = false;
		const secondStatusPromise = waitForJson(
			workspace.socket,
			(message) => message.type === 'status.sample' && message.payload?.timestamp !== firstTimestamp,
			10_000,
		).then((sample) => {
			receivedSecond = true;
			return sample;
		});
		await nextTurn();
		await vi.advanceTimersByTimeAsync(intervalMs - 1);
		expect(Date.now() - startedAt).toBe(intervalMs - 1);
		expect(receivedSecond).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const secondStatus = await secondStatusPromise;
		const secondTimestamp = secondStatus.payload?.timestamp;
		const thirdStatusPromise = waitForJson(
			workspace.socket,
			(message) =>
				message.type === 'status.sample' &&
				message.payload?.timestamp !== firstTimestamp &&
				message.payload?.timestamp !== secondTimestamp,
			10_000,
		);
		await nextTurn();
		await vi.advanceTimersByTimeAsync(intervalMs);
		const thirdStatus = await thirdStatusPromise;
		expect(Date.now() - startedAt).toBe(2 * intervalMs);
		expect(secondTimestamp - firstTimestamp).toBe(intervalMs);
		expect(thirdStatus.payload?.timestamp - secondTimestamp).toBe(intervalMs);

		const docker = readWorkspaceDockerStatusResponse(await requestWorkspace(workspace.socket, 'docker.status'));
		await requestWorkspace(workspace.socket, 'status.stop');

		expect(readRemoteStatusSample(firstStatus.payload)).toMatchObject({
			osName: 'Nexus E2E Linux',
			cpuModel: 'Nexus Virtual CPU',
			memTotal: 2048,
			diskPercent: 30,
			netInterface: 'eth0',
		});
		expect(readRemoteStatusSample(secondStatus.payload).netRxRate).toBeGreaterThan(0);
		expect(readRemoteStatusSample(secondStatus.payload).netTxRate).toBeGreaterThan(0);
		expect(readRemoteStatusSample(thirdStatus.payload).netRxRate).toBeGreaterThan(0);

		expect(docker).toMatchObject({ available: true });
		expect(docker.containers).toHaveLength(1);
		expect(docker.containers[0]).toMatchObject({
			names: ['nexus-e2e-container'],
			image: 'alpine:latest',
			state: 'running',
		});
		expect(docker.containers[0].stats).toMatchObject({ cpuPercent: '12.34%' });
	} finally {
		try {
			await closeWebSocket(workspace.socket);
		} finally {
			vi.useRealTimers();
		}
	}
});
