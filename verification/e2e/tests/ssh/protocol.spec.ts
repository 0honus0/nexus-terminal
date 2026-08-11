import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openSshSession, requestJson, waitForSftpReady } from '../../support/ws';
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
