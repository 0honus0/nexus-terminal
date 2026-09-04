import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
  setTestSshOnline,
} from '../../support/ssh';
import { step } from '../../support/steps';

test('disconnected SSH retries periodically and any key reconnects immediately', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await setTestSshOnline(true);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  let openedWebSockets = 0;
  let workspaceConnectRequests = 0;
  let workspaceConnectResponses = 0;
  const pendingWorkspaceConnectRequests = new Set<string>();
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/ws')) return;
    openedWebSockets += 1;
    socket.on('framesent', (event) => {
      if (typeof event.payload !== 'string') return;
      try {
        const message = JSON.parse(event.payload) as { type?: string; requestId?: string };
        if (message.type === 'workspace.connect' && message.requestId) {
          workspaceConnectRequests += 1;
          pendingWorkspaceConnectRequests.add(message.requestId);
        }
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
          pendingWorkspaceConnectRequests.delete(message.requestId)
        ) {
          workspaceConnectResponses += 1;
        }
      } catch {
        // Ignore non-JSON frames; terminal output is normally binary.
      }
    });
  });

  await connectTestSshFromConnectionsPage(page, connectionId);
  const terminal = page.getByTestId('terminal');
  const xtermInput = terminal.locator('.xterm-helper-textarea');
  const commandInput = page.getByTestId('command-input');

  await step('initial SSH session is connected', async () => {
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(xtermInput).toBeAttached();
    await expect.poll(() => openedWebSockets).toBeGreaterThanOrEqual(1);
    await expect.poll(() => workspaceConnectResponses, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  });

  const initialConnectRequestCount = workspaceConnectRequests;
  const initialConnectedCount = workspaceConnectResponses;

  try {
    await step('SSH outage triggers more than one automatic reconnect cycle', async () => {
      await setTestSshOnline(false);

      // First reconnect is scheduled after 2s and the next after 4s. The clean Workspace
      // transport may reuse the same already-open /ws/workspace control socket after an
      // SSH-level connect failure, so business reconnect attempts are counted by their
      // workspace.connect requests rather than by forcing a new WebSocket per attempt.
      await expect
        .poll(() => workspaceConnectRequests, { timeout: 12_000 })
        .toBeGreaterThanOrEqual(initialConnectRequestCount + 2);
    });

    await step('any terminal key interrupts backoff and reconnects immediately', async () => {
      await setTestSshOnline(true);
      const beforeKeypress = workspaceConnectRequests;

      await xtermInput.focus();
      await page.keyboard.press('x');

      // The scheduled retry is still in backoff. A fresh workspace.connect request
      // within 2.5s therefore comes from reconnectNow(), even when the control socket
      // itself is intentionally reused.
      await expect.poll(() => workspaceConnectRequests, { timeout: 2_500 }).toBeGreaterThan(beforeKeypress);
      await expect.poll(() => workspaceConnectResponses, { timeout: 5_000 }).toBeGreaterThan(initialConnectedCount);

      await commandInput.fill("printf 'NEXUS_RECONNECTED_E2E\\n'");
      await commandInput.press('Enter');
      await expect
        .poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 10_000 })
        .toContain('NEXUS_RECONNECTED_E2E');
    });
  } finally {
    await setTestSshOnline(true);
  }
});
