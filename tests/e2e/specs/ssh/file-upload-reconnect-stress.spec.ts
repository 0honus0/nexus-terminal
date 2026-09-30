import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { dragLocalFiles, openFileManager, uploadProgressTask } from '../../support/file-upload';
import {
  closeConnectedFileManager,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  openConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';

test('repeated cancelled-upload teardown keeps fresh Workspace WebSockets reconnectable', async ({
  page,
  context,
  request,
}) => {
  test.slow();
  const stressCycles = 8;
  let activePage = page;
  await openFileManager(activePage, context);

  try {
    for (let cycle = 1; cycle <= stressCycles; cycle += 1) {
      const filename = `cancel-reset-reconnect-${String(cycle).padStart(2, '0')}.bin`;
      const delayResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=900`, { method: 'POST' });
      expect(delayResponse.ok).toBeTruthy();

      await dragLocalFiles(activePage, [{ name: filename, size: 2 * 1024 * 1024, fill: 0x40 + cycle }]);
      const task = uploadProgressTask(activePage, filename);
      await expect(task, `cycle ${cycle}: upload task should start before teardown`).toBeVisible({ timeout: 10_000 });
      await closeConnectedFileManager(activePage);
      await task.getByRole('button', { name: 'Cancel', exact: true }).click();

      // Deliberately overlap browser transport loss, upload cancellation, Backend runtime teardown,
      // session clearing, and SSH-server reset. This is the churn that previously made a later
      // /ws/workspace upgrade intermittently fall through the shared dev/E2E WebSocket proxy.
      await context.setOffline(true);
      const resetResponse = await request.post('/api/v1/__e2e/reset', {
        data: { mode: 'seed' },
      });
      expect(
        resetResponse.ok(),
        `cycle ${cycle}: Backend E2E reset failed: ${await resetResponse.text()}`,
      ).toBeTruthy();
      await resetTestSshFilesystem();

      // A new browser page models the next E2E case: old Workspace/upload sockets are gone, while
      // the same long-lived Vite ingress must accept a brand-new Workspace control upgrade.
      await activePage.close();
      await context.setOffline(false);
      await loginAsInitialAdmin(context.request);
      await configureSshE2eSettings(context.request);
      const connectionId = await ensureTestSshConnection(context.request);
      activePage = await context.newPage();
      const freshConnect = { requests: 0, successes: 0, pending: new Set<string>() };
      activePage.on('websocket', (socket) => {
        if (new URL(socket.url()).pathname !== '/ws/workspace') return;
        socket.on('framesent', (event) => {
          if (typeof event.payload !== 'string') return;
          try {
            const message = JSON.parse(event.payload) as { type?: string; requestId?: string };
            if (message.type !== 'workspace.connect' || !message.requestId) return;
            freshConnect.requests += 1;
            freshConnect.pending.add(message.requestId);
          } catch {
            // Ignore non-JSON frames.
          }
        });
        socket.on('framereceived', (event) => {
          if (typeof event.payload !== 'string') return;
          try {
            const message = JSON.parse(event.payload) as {
              type?: string;
              requestId?: string;
              payload?: { ok?: boolean };
            };
            if (
              message.type === 'response' &&
              message.requestId &&
              message.payload?.ok === true &&
              freshConnect.pending.delete(message.requestId)
            ) {
              freshConnect.successes += 1;
            }
          } catch {
            // Ignore non-JSON frames.
          }
        });
      });
      await connectTestSshFromConnectionsPage(activePage, connectionId);
      await openConnectedFileManager(activePage);
      await expect(
        activePage.locator('.command-bar-command-input'),
        `cycle ${cycle}: fresh Workspace control socket should reconnect after teardown`,
      ).toBeEnabled();
      expect(freshConnect.requests, `cycle ${cycle}: reset must leave the first fresh workspace.connect usable`).toBe(
        1,
      );
      expect(freshConnect.successes, `cycle ${cycle}: first fresh workspace.connect must succeed`).toBe(1);
    }
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
    if (!activePage.isClosed()) await activePage.close();
  }
});
