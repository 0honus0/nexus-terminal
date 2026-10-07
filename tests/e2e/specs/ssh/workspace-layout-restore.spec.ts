import { expect, test, type Route } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, connectTestSshFromConnectionsPage, ensureTestSshConnection } from '../../support/ssh';

test('returning from settings waits for saved layout and sidebar before resizing a live terminal', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const geometry: Array<{ columns: number; rows: number }> = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return;
      const frame = JSON.parse(payload);
      if (frame.type === 'terminal.resize') geometry.push(frame.payload);
    });
  });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { navBarVisible: true } })).ok()).toBeTruthy();
  expect(
    (
      await context.request.put('/api/v1/settings/workspace-layout', {
        data: {
          layout: {
            id: 'restore-root',
            type: 'container',
            direction: 'vertical',
            children: [
              { id: 'restore-terminal', type: 'pane', component: 'terminal', size: 90 },
              { id: 'restore-command', type: 'pane', component: 'commandBar', size: 10 },
            ],
          },
          sidebar: { left: [], right: [] },
        },
      })
    ).ok(),
  ).toBeTruthy();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  const terminal = page.locator('.terminal-inner-container');
  const command = page.locator('.command-bar-command-input');
  await command.fill("printf 'LAYOUT_RESTORE_READY\\n'");
  await command.press('Enter');
  await expect(terminal).toContainText('LAYOUT_RESTORE_READY');
  await expect.poll(() => geometry.length).toBeGreaterThan(0);
  const savedGeometry = geometry.at(-1)!;
  const savedBox = (await terminal.boundingBox())!;

  for (const setting of ['layout', 'sidebar']) {
    await page.locator('a[href="/settings"]').first().click();
    await expect(page).toHaveURL(/\/settings/);
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pattern = `**/api/v1/settings/${setting}`;
    const handler = async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response });
    };
    await page.route(pattern, handler);
    geometry.length = 0;
    try {
      await page.locator('a[href="/workspace"]').first().click();
      await pending;
      // Simulate a slow settings response and inspect the intermediate view, not just its final state.
      await page.waitForTimeout(300);
      await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected');
      await expect(page.locator('.workspace-split')).toHaveCount(0);
      await expect(terminal).toHaveCount(0);
      expect(geometry).toEqual([]);
      release();
      await expect(terminal).toContainText('LAYOUT_RESTORE_READY');
      await expect.poll(() => geometry.length).toBeGreaterThan(0);
      await page.waitForTimeout(250);
      expect(
        geometry.every(
          (viewport) => viewport.columns === savedGeometry.columns && viewport.rows === savedGeometry.rows,
        ),
      ).toBe(true);
      const restoredBox = (await terminal.boundingBox())!;
      expect(Math.abs(restoredBox.width - savedBox.width)).toBeLessThan(1);
      expect(Math.abs(restoredBox.height - savedBox.height)).toBeLessThan(1);
      await command.fill(`printf 'LAYOUT_RESTORE_${setting}\\n'`);
      await command.press('Enter');
      await expect(terminal).toContainText(`LAYOUT_RESTORE_${setting}`);
    } finally {
      release();
      await page.unroute(pattern, handler);
    }
  }
});
