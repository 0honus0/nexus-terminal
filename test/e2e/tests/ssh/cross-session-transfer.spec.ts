import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  type E2eWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  waitForFilesystemReady,
  waitForJson,
} from '../../support/ws';
import { step, slowStep } from '../../support/steps';

async function createConnection(request: APIRequestContext, name: string): Promise<number> {
  const response = await request.post('/api/v1/connections', {
    data: {
      name,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { connection: { id: number } }).connection.id;
}

async function readRemoteFile(socket: E2eWebSocket, remotePath: string): Promise<string> {
  const response = await requestWorkspace<{ content: string }>(socket, 'filesystem.readText', {
    path: remotePath,
    encoding: 'utf-8',
  });
  return response.content;
}

async function runTransfer(
  socket: E2eWebSocket,
  requestId: string,
  payload: { mode: 'copy' | 'move'; sourceWorkspaceId: string; sources: string[]; destination: string },
) {
  const progressPromise = waitForJson(
    socket,
    (message) =>
      message.type === 'transfer.copyMove' &&
      message.payload?.requestId === requestId &&
      message.payload?.type === 'progress' &&
      message.payload?.totalKnown === true,
    20_000,
  );
  const completedPromise = waitForJson(
    socket,
    (message) =>
      message.type === 'transfer.copyMove' &&
      message.payload?.requestId === requestId &&
      message.payload?.type === 'completed',
    30_000,
  );
  await requestWorkspace(socket, 'transfer.copyMove', payload, requestId, 30_000);
  const progress = await progressPromise;
  await completedPromise;
  return progress.payload;
}

test('cross-session copy and move transfer data and progress over real SFTP', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();

  const sourceId = await createConnection(request, 'E2E Cross Source');
  const destinationId = await createConnection(request, 'E2E Cross Destination');
  const source = await openWorkspaceSession(request, sourceId, `cross-source-${crypto.randomUUID()}`);
  const destination = await openWorkspaceSession(request, destinationId, `cross-destination-${crypto.randomUUID()}`);

  try {
    await Promise.all([waitForFilesystemReady(source.socket), waitForFilesystemReady(destination.socket)]);

    await slowStep('cross-session copy emits progress and writes the destination', async () => {
      const progress = await runTransfer(destination.socket, `cross-copy-${crypto.randomUUID()}`, {
        mode: 'copy',
        sourceWorkspaceId: source.workspaceId,
        sources: ['/cross-copy.txt'],
        destination: '/cross-target',
      });
      expect(progress).toMatchObject({ totalKnown: true });
      expect(Number(progress?.totalBytes)).toBeGreaterThan(0);
      await expect(readRemoteFile(destination.socket, '/cross-target/cross-copy.txt')).resolves.toContain(
        'cross-copy-body',
      );
    });

    await slowStep('two-phase cross-session move deletes source only after copy success', async () => {
      await runTransfer(destination.socket, `cross-move-${crypto.randomUUID()}`, {
        mode: 'move',
        sourceWorkspaceId: source.workspaceId,
        sources: ['/cross-move.txt'],
        destination: '/cross-target',
      });

      await expect(readRemoteFile(destination.socket, '/cross-target/cross-move.txt')).resolves.toContain(
        'cross-move-body',
      );
      const root = await requestWorkspace<{ entries: Array<{ name: string }> }>(source.socket, 'filesystem.list', {
        path: '/',
      });
      expect(root.entries.map((item) => item.name)).not.toContain('cross-move.txt');
    });
  } finally {
    await Promise.all([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
  }
});
