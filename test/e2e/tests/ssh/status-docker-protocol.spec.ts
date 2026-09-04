import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace, waitForJson } from '../../support/ws';

test('status monitor and Docker protocols work through the live SSH session', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `status-${crypto.randomUUID()}`);

  try {
    const firstStatusPromise = waitForJson(workspace.socket, (message) => message.type === 'status.sample');
    await requestWorkspace(workspace.socket, 'status.start');
    const firstStatus = await firstStatusPromise;
    const firstTimestamp = firstStatus.payload?.timestamp;
    const secondStatus = await waitForJson(
      workspace.socket,
      (message) => message.type === 'status.sample' && message.payload?.timestamp !== firstTimestamp,
      10_000,
    );

    const docker = await requestWorkspace<{
      available: boolean;
      containers: Array<{
        names: string[];
        image: string;
        state: string;
        stats?: { cpuPercent?: string };
      }>;
    }>(workspace.socket, 'docker.status');
    await requestWorkspace(workspace.socket, 'status.stop');

    expect(firstStatus.payload).toMatchObject({
      osName: 'Nexus E2E Linux',
      cpuModel: 'Nexus Virtual CPU',
      memTotal: 2048,
      diskPercent: 30,
      netInterface: 'eth0',
    });
    expect(Number(secondStatus.payload?.netRxRate)).toBeGreaterThan(0);
    expect(Number(secondStatus.payload?.netTxRate)).toBeGreaterThan(0);

    expect(docker).toMatchObject({ available: true });
    expect(docker.containers).toHaveLength(1);
    expect(docker.containers[0]).toMatchObject({
      names: ['nexus-e2e-container'],
      image: 'alpine:latest',
      state: 'running',
    });
    expect(docker.containers[0].stats).toMatchObject({ cpuPercent: '12.34%' });
  } finally {
    await closeWebSocket(workspace.socket);
  }
});
