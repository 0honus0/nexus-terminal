import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace, waitForBinaryText } from '../../support/ws';

test.use({
  viewport: { width: 1180, height: 820 },
  hasTouch: true,
  isMobile: false,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});

test('wide touch Pad contains downward drags at empty history, history top and alternate screen', async ({
  page,
  context,
}) => {
  let wireOutput = '';
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/ws/workspace')) return;
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') wireOutput = (wireOutput + payload.toString('utf8')).slice(-32768);
    });
  });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  const terminal = page.locator('.terminal-inner-container');
  const command = page.locator('.command-bar-command-input');
  const drag = async (direction = 1) => {
    expect(await terminal.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
    await terminal.evaluate((element, direction) => {
      const box = element.getBoundingClientRect();
      const touch = (offset: number) =>
        new Touch({ identifier: 81, target: element, clientX: box.x + 80, clientY: box.y + 220 + direction * offset });
      const start = touch(0);
      element.dispatchEvent(
        new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [start], changedTouches: [start] }),
      );
      for (const offset of [40, 80, 120, 160]) {
        const moved = touch(offset);
        const event = new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [moved],
          changedTouches: [moved],
        });
        element.dispatchEvent(event);
        if (!event.defaultPrevented) throw new Error('Downward terminal drag escaped to the page');
      }
      element.dispatchEvent(
        new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(160)] }),
      );
    }, direction);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  };
  await drag();
  await command.fill('for ((i=0;i<100;i++)); do printf "PAD_TOP_%03d\\n" "$i"; done');
  await command.press('Enter');
  await expect(terminal).toContainText('PAD_TOP_099');
  for (let i = 0; i < 10; i++) await drag();
  await expect(terminal).toContainText('PAD_TOP_000');
  await drag();
  await command.fill(
    'printf "\\033[?1049h\\033[2J\\033[HPAD_%s" ALT_SCREEN; while IFS= read -rsn1 key; do [[ "$key" == q ]] && break; done; printf "\\033[?1049l"; printf "PAD_%s\\n" BOUNDARY_OK',
  );
  await command.press('Enter');
  await expect(terminal).toContainText('PAD_ALT_SCREEN');
  await drag();
  await expect(terminal).toContainText('PAD_ALT_SCREEN');
  await command.fill('q');
  await command.press('Enter');
  await expect(terminal).not.toContainText('PAD_ALT_SCREEN');
  await expect.poll(() => wireOutput).toContain('PAD_BOUNDARY_OK');
  for (let i = 0; i < 10; i++) await drag(-1);
  await expect(terminal).toContainText('PAD_BOUNDARY_OK');
});

for (const outputKind of ['line logs', 'single line'] as const) {
  test(`wide touch Pad resumes the original shell after real detached ${outputKind} exceed retained history`, async ({
    page,
    context,
  }) => {
    page.on('pageerror', (error) => console.error('PAD_PAGE_ERROR', error));
    page.on('crash', () => console.error('PAD_PAGE_CRASH'));
    await loginAsInitialAdmin(context.request);
    await configureSshE2eSettings(context.request);
    await resetTestSshFilesystem();
    const connectionId = await ensureTestSshConnection(context.request);
    const original = await openWorkspaceSession(context.request, connectionId, `pad-output-${crypto.randomUUID()}`);
    const gate = path.resolve(__dirname, '../../.tmp/ssh-root/pad-output-release');
    const log = path.resolve(
      __dirname,
      '../../.tmp/backend-data/temp_suspended_ssh_logs',
      `${original.workspaceId}.log`,
    );
    try {
      await requestWorkspace(original.socket, 'suspend.mark');
      const started = waitForBinaryText(original.socket, 'PAD_PRODUCER_READY');
      const producer =
        outputKind === 'line logs'
          ? 'yes "PAD_BACKGROUND_LOG_0123456789_abcdefghijklmnopqrstuvwxyz" | head -c 117440512'
          : 'head -c 117440512 /dev/zero | tr "\\000" x';
      await requestWorkspace(original.socket, 'terminal.input', {
        data: `PAD_SHELL=$$; printf "PAD_%s\\n" PRODUCER_READY; while [ ! -f "$NEXUS_E2E_ROOT/pad-output-release" ]; do sleep 0.05; done; ${producer}; printf "\\nPAD_%s\\n" DETACHED_OUTPUT_DONE; for ((i=0;i<120;i++)); do printf "PAD_HISTORY_%03d\\n" "$i"; done; printf "PAD_%s\\n" LATEST_SCREEN\r`,
      });
      await started;
      await closeWebSocket(original.socket);
      let suspendedId = '';
      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/ssh-suspend/suspended-sessions');
          expect(response.ok()).toBeTruthy();
          const sessions = await response.json();
          suspendedId =
            sessions.find(
              (session: { originalWorkspaceId: string; ownershipState: string }) =>
                session.originalWorkspaceId === original.workspaceId && session.ownershipState === 'available',
            )?.id ?? '';
          return suspendedId;
        })
        .not.toBe('');
      // Release only after the backend confirms detached ownership. All 112 MiB
      // comes from the real shell while suspended, not from a seeded log file.
      await fs.writeFile(gate, 'release');
      await expect
        .poll(
          async () => {
            const handle = await fs.open(log, 'r');
            try {
              const { size } = await handle.stat();
              const tail = Buffer.alloc(Math.min(4096, size));
              await handle.read(tail, 0, tail.length, size - tail.length);
              return tail.toString().includes('PAD_LATEST_SCREEN');
            } finally {
              await handle.close();
            }
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      const bytes = (await fs.stat(log)).size;
      expect(bytes).toBeGreaterThanOrEqual(100 * 1024 * 1024);
      expect(bytes).toBeLessThan(116 * 1024 * 1024);
      await page.goto('/workspace');
      await page
        .locator(`[data-suspend-id="${suspendedId}"]`)
        .getByRole('button', { name: 'Resume', exact: true })
        .click();
      await expect(page.getByText(/resumed successfully\.$/)).toBeVisible({ timeout: 20_000 });
      const terminal = page.locator('.terminal-inner-container');
      await expect(terminal).toContainText('PAD_LATEST_SCREEN');
      await expect(terminal).toHaveClass(/terminal-mobile-touch/);
      const command = page.locator('.command-bar-command-input');
      await command.fill('if [[ "$PAD_SHELL" == "$$" ]]; then printf "%s%s\\n" PAD_ORIGINAL_ SHELL_OK; fi');
      await command.press('Enter');
      await expect(terminal).toContainText('PAD_ORIGINAL_SHELL_OK');
      const dragHistory = () =>
        terminal.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const touch = (y: number) => new Touch({ identifier: 71, target: element, clientX: box.x + 80, clientY: y });
          const send = (type: string, touches: Touch[], changedTouches: Touch[]) =>
            element.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches,
                targetTouches: touches,
                changedTouches,
              }),
            );
          const start = touch(box.y + 80);
          send('touchstart', [start], [start]);
          for (let i = 1; i <= 8; i++) {
            const moved = touch(box.y + 80 + i * 35);
            if (send('touchmove', [moved], [moved])) throw new Error('Terminal drag did not prevent native scrolling');
          }
          send('touchend', [], [touch(box.y + 360)]);
        });
      await dragHistory();
      await expect(terminal).toContainText('PAD_HISTORY_098');
      await dragHistory();
      await expect(terminal).not.toContainText('PAD_ORIGINAL_SHELL_OK');
      await expect(terminal).toContainText('PAD_HISTORY_');
    } finally {
      await fs.writeFile(gate, 'release');
      await closeWebSocket(original.socket);
    }
  });
}
