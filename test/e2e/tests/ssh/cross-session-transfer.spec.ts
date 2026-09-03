import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openSshSession, requestJson, waitForJson, waitForSftpReady } from '../../support/ws';
import { step, slowStep } from '../../support/steps';

async function createConnection(request: APIRequestContext, name: string): Promise<number> {
  const response = await request.post('/api/v1/connections', {
    data: {
      name,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      auth_method: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { connection: { id: number } }).connection.id;
}

async function readRemoteFile(socket: any, remotePath: string): Promise<string> {
  const response = await requestJson(
    socket,
    'sftp:readfile',
    { path: remotePath, encoding: 'utf8' },
    'sftp:readfile:success',
    'sftp:readfile:error',
  );
  return Buffer.from(String(response.payload?.rawContentBase64 ?? ''), 'base64').toString('utf8');
}

test('cross-session copy and move transfer data and progress over real SFTP', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();

  const sourceId = await createConnection(request, 'E2E Cross Source');
  const destinationId = await createConnection(request, 'E2E Cross Destination');
  const source = await openSshSession(request, sourceId, `cross-source-${crypto.randomUUID()}`);
  const destination = await openSshSession(request, destinationId, `cross-destination-${crypto.randomUUID()}`);

  try {
    await Promise.all([waitForSftpReady(source.socket), waitForSftpReady(destination.socket)]);

    await slowStep('cross-session copy emits progress and writes the destination', async () => {
      const requestId = `cross-copy-${crypto.randomUUID()}`;
      const progressPromise = waitForJson(
        destination.socket,
        (message) =>
          message.type === 'sftp:transfer:progress' &&
          message.requestId === requestId &&
          message.payload?.totalKnown === true,
        20_000,
      );
      await requestJson(
        destination.socket,
        'sftp:cross_copy',
        { sourceSessionId: source.sessionId, sources: ['/cross-copy.txt'], destination: '/cross-target' },
        'sftp:copy:success',
        'sftp:copy:error',
        requestId,
        30_000,
      );
      const progress = await progressPromise;
      expect(progress.payload).toMatchObject({ totalKnown: true });
      expect(Number(progress.payload?.totalBytes)).toBeGreaterThan(0);
      await expect(readRemoteFile(destination.socket, '/cross-target/cross-copy.txt')).resolves.toContain(
        'cross-copy-body',
      );
    });

    await slowStep('two-phase cross-session move deletes source only after copy success', async () => {
      const requestId = `cross-move-${crypto.randomUUID()}`;
      await requestJson(
        destination.socket,
        'sftp:cross_copy',
        { sourceSessionId: source.sessionId, sources: ['/cross-move.txt'], destination: '/cross-target' },
        'sftp:copy:success',
        'sftp:copy:error',
        requestId,
        30_000,
      );
      await requestJson(
        source.socket,
        'sftp:delete_paths',
        { paths: ['/cross-move.txt'] },
        'sftp:delete_paths:success',
        'sftp:delete_paths:error',
        requestId,
      );

      await expect(readRemoteFile(destination.socket, '/cross-target/cross-move.txt')).resolves.toContain(
        'cross-move-body',
      );
      const root = await requestJson(
        source.socket,
        'sftp:readdir',
        { path: '/' },
        'sftp:readdir:success',
        'sftp:readdir:error',
      );
      const names = (Array.isArray(root.payload) ? root.payload : []).map(
        (item: { filename?: string }) => item.filename,
      );
      expect(names).not.toContain('cross-move.txt');
    });
  } finally {
    await Promise.all([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
  }
});
