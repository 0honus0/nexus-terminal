import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openAuthenticatedWebSocket, sendJson, waitForJson } from '../../support/ws';

test('status monitor and Docker protocols work through the live SSH session', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const socket = await openAuthenticatedWebSocket(request);

  try {
    const connectedPromise = waitForJson(socket, (message) => message.type === 'ssh:connected');
    sendJson(socket, {
      type: 'ssh:connect',
      payload: { connectionId: String(connectionId), clientSessionId: `status-${crypto.randomUUID()}` },
    });
    await connectedPromise;

    const firstStatusPromise = waitForJson(socket, (message) => message.type === 'status_update');
    sendJson(socket, { type: 'status:subscribe', payload: {} });
    const firstStatus = await firstStatusPromise;
    const firstTimestamp = firstStatus.payload?.status?.timestamp;
    const secondStatus = await waitForJson(
      socket,
      (message) => message.type === 'status_update' && message.payload?.status?.timestamp !== firstTimestamp,
      10_000,
    );

    const dockerPromise = waitForJson(
      socket,
      (message) => message.type === 'docker:status:update' || message.type === 'docker:status:error',
      15_000,
    );
    sendJson(socket, { type: 'docker:get_status', payload: {} });
    const docker = await dockerPromise;
    expect(docker.type).toBe('docker:status:update');
    sendJson(socket, { type: 'status:unsubscribe', payload: {} });

    expect(firstStatus.payload?.status).toMatchObject({
      osName: 'Nexus E2E Linux',
      cpuModel: 'Nexus Virtual CPU',
      memTotal: 2048,
      diskPercent: 30,
      netInterface: 'eth0',
    });
    expect(Number(secondStatus.payload?.status?.netRxRate)).toBeGreaterThan(0);
    expect(Number(secondStatus.payload?.status?.netTxRate)).toBeGreaterThan(0);

    expect(docker.payload).toMatchObject({ available: true });
    expect(docker.payload?.containers).toHaveLength(1);
    expect(docker.payload?.containers[0]).toMatchObject({
      Names: ['nexus-e2e-container'],
      Image: 'alpine:latest',
      State: 'running',
    });
    expect(docker.payload?.containers[0].stats).toMatchObject({ CPUPerc: '12.34%' });
  } finally {
    await closeWebSocket(socket);
  }
});
