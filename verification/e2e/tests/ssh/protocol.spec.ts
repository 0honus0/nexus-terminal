import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openSshSession, requestJson, sendJson, waitForJson, waitForSftpReady } from '../../support/ws';
import { step } from '../../support/steps';

test('backend can authenticate to the real SSH test server', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();

  const response = await request.post('/api/v1/connections/test-unsaved', {
    data: {
      name: E2E_SSH.name,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      auth_method: 'password',
      password: E2E_SSH.password,
    },
  });

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ success: true });
});

test('duplicate ssh:connect stays non-fatal and leaves SFTP usable', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `duplicate-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    await step('repeat ssh:connect on the same live websocket', async () => {
      const infoPromise = waitForJson(
        session.socket,
        (message) => message.type === 'info' && String(message.payload ?? '').includes('重复连接请求'),
        10_000,
      );
      sendJson(session.socket, {
        type: 'ssh:connect',
        payload: { connectionId: String(connectionId), clientSessionId: session.sessionId },
      });
      await infoPromise;
    });

    await step('SFTP operations still work after the duplicate request', async () => {
      const root = await requestJson(
        session.socket,
        'sftp:readdir',
        { path: '/' },
        'sftp:readdir:success',
        'sftp:readdir:error',
      );
      expect((Array.isArray(root.payload) ? root.payload : []).map((item: { filename?: string }) => item.filename))
        .toContain('seed.txt');
    });
  } finally {
    await closeWebSocket(session.socket);
  }
});

test('same-session move treats a missing destination path as available', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `move-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    await step('move a file into an existing directory', async () => {
      await requestJson(
        session.socket,
        'sftp:move',
        { sources: ['/move-source.txt'], destination: '/folder-seed' },
        'sftp:move:success',
        'sftp:move:error',
      );

      const destination = await requestJson(
        session.socket,
        'sftp:readfile',
        { path: '/folder-seed/move-source.txt', encoding: 'utf8' },
        'sftp:readfile:success',
        'sftp:readfile:error',
      );
      expect(Buffer.from(String(destination.payload?.rawContentBase64 ?? ''), 'base64').toString('utf8'))
        .toContain('move-me');

      const root = await requestJson(
        session.socket,
        'sftp:readdir',
        { path: '/' },
        'sftp:readdir:success',
        'sftp:readdir:error',
      );
      expect((Array.isArray(root.payload) ? root.payload : []).map((item: { filename?: string }) => item.filename))
        .not.toContain('move-source.txt');
    });
  } finally {
    await closeWebSocket(session.socket);
  }
});

test('archive commands use the same remote root as SFTP', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `archive-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    await step('compress and decompress a file in the SFTP root', async () => {
      const compressRequestId = `archive-compress-${crypto.randomUUID()}`;
      const compressResponsePromise = waitForJson(
        session.socket,
        (message) => message.requestId === compressRequestId
          && ['sftp:compress:success', 'sftp:compress:error', 'sftp:command_not_found'].includes(String(message.type)),
        30_000,
      );
      sendJson(session.socket, {
        type: 'sftp:compress',
        requestId: compressRequestId,
        payload: { sources: ['/archive-source.txt'], destination: '/archive-source.zip', format: 'zip' },
      });
      const compressResponse = await compressResponsePromise;
      test.skip(compressResponse.type === 'sftp:command_not_found', 'zip is not installed in this test environment');
      expect(compressResponse.type).toBe('sftp:compress:success');

      await requestJson(
        session.socket,
        'sftp:delete_paths',
        { paths: ['/archive-source.txt'] },
        'sftp:delete_paths:success',
        'sftp:delete_paths:error',
      );

      const decompressRequestId = `archive-decompress-${crypto.randomUUID()}`;
      const decompressResponsePromise = waitForJson(
        session.socket,
        (message) => message.requestId === decompressRequestId
          && ['sftp:decompress:success', 'sftp:decompress:error', 'sftp:command_not_found'].includes(String(message.type)),
        30_000,
      );
      sendJson(session.socket, {
        type: 'sftp:decompress',
        requestId: decompressRequestId,
        payload: { source: '/archive-source.zip' },
      });
      const decompressResponse = await decompressResponsePromise;
      test.skip(decompressResponse.type === 'sftp:command_not_found', 'unzip is not installed in this test environment');
      expect(decompressResponse.type).toBe('sftp:decompress:success');

      const restored = await requestJson(
        session.socket,
        'sftp:readfile',
        { path: '/archive-source.txt', encoding: 'utf8' },
        'sftp:readfile:success',
        'sftp:readfile:error',
      );
      expect(Buffer.from(String(restored.payload?.rawContentBase64 ?? ''), 'base64').toString('utf8'))
        .toContain('archive-me');
    });
  } finally {
    await closeWebSocket(session.socket);
  }
});
