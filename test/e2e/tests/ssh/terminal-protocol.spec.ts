import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace, waitForJson } from '../../support/ws';

test('the first directory change waits for a real shell prompt instead of reporting foreground activity', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const targetPath = '/folder-seed';
  const workspace = await openWorkspaceSession(request, connectionId, `cwd-${crypto.randomUUID()}`);

  try {
    // Historical race: issue the first cwd change immediately after workspace.connect completes.
    const requestId = `cwd-${crypto.randomUUID()}`;
    const changedPromise = waitForJson(
      workspace.socket,
      (message) => message.type === 'terminal.directoryChanged' && message.payload?.requestId === requestId,
      20_000,
    );
    const failedPromise = waitForJson(
      workspace.socket,
      (message) => message.type === 'terminal.directoryChangeFailed' && message.payload?.requestId === requestId,
      1_000,
    ).catch(() => null);
    await expect(
      requestWorkspace(workspace.socket, 'terminal.changeDirectory', { path: targetPath }, requestId),
    ).resolves.toMatchObject({ queued: true });
    const changed = await changedPromise;
    expect(changed.payload).toMatchObject({ path: targetPath });
    expect(await failedPromise).toBeNull();
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('directory changes reject terminal control characters before writing to the PTY', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `cwd-control-${crypto.randomUUID()}`);

  try {
    const requestId = `cwd-control-${crypto.randomUUID()}`;
    const failedPromise = waitForJson(
      workspace.socket,
      (message) => message.type === 'terminal.directoryChangeFailed' && message.payload?.requestId === requestId,
      10_000,
    );
    await expect(
      requestWorkspace(
        workspace.socket,
        'terminal.changeDirectory',
        { path: '/folder-seed\nsecond-command' },
        requestId,
      ),
    ).resolves.toMatchObject({ queued: true });
    const failed = await failedPromise;
    expect(failed.payload?.message).toContain('控制字符');
  } finally {
    await closeWebSocket(workspace.socket);
  }
});
