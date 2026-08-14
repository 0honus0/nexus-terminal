import { expect, test } from '@playwright/test';
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
  let closedWebSockets = 0;
  let sshConnectedFrames = 0;
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/ws')) return;
    openedWebSockets += 1;
    socket.on('close', () => {
      closedWebSockets += 1;
    });
    socket.on('framereceived', (event) => {
      if (typeof event.payload !== 'string') return;
      try {
        const message = JSON.parse(event.payload) as { type?: string };
        if (message.type === 'ssh:connected') sshConnectedFrames += 1;
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
    await expect.poll(() => sshConnectedFrames, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  });

  const initialWebSocketCount = openedWebSockets;
  const initialConnectedCount = sshConnectedFrames;

  try {
    await step('SSH outage triggers more than one automatic reconnect cycle', async () => {
      await setTestSshOnline(false);

      // First reconnect is scheduled after 2s. Because the SSH listener is offline,
      // that WebSocket fails and the next reconnect is scheduled after 4s. Seeing
      // two fresh frontend WebSockets proves the retry loop continues beyond one shot.
      await expect.poll(() => openedWebSockets, { timeout: 9_000 })
        .toBeGreaterThanOrEqual(initialWebSocketCount + 2);

      // Wait until the second failed reconnect WebSocket has actually closed. The next
      // automatic attempt is now in its 8s backoff window, which gives the keypress test
      // a deterministic window in which it must beat the timer.
      await expect.poll(() => closedWebSockets, { timeout: 4_000 })
        .toBeGreaterThanOrEqual(initialWebSocketCount + 2);
    });

    await step('any terminal key interrupts backoff and reconnects immediately', async () => {
      await setTestSshOnline(true);
      const beforeKeypress = openedWebSockets;

      await xtermInput.focus();
      await page.keyboard.press('x');

      // The scheduled retry is 8s away. A new WebSocket within 2.5s therefore has to
      // come from reconnectNow(), which is driven by the terminal keypress.
      await expect.poll(() => openedWebSockets, { timeout: 2_500 })
        .toBeGreaterThan(beforeKeypress);
      await expect.poll(() => sshConnectedFrames, { timeout: 5_000 })
        .toBeGreaterThan(initialConnectedCount);

      await commandInput.fill("printf 'NEXUS_RECONNECTED_E2E\\n'");
      await commandInput.press('Enter');
      await expect.poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 10_000 })
        .toContain('NEXUS_RECONNECTED_E2E');
    });
  } finally {
    await setTestSshOnline(true);
  }
});
