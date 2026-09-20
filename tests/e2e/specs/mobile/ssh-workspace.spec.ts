import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  E2E_SSH,
  activeFileManagerList,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { captureFunctionalScreenshot, functionalScreenshotsEnabled } from '../../support/functional-screenshots';
import { step, slowStep } from '../../support/steps';

const MOBILE_LONG_FILENAME = `mobile-long-name-${'x'.repeat(180)}.txt`;

test('mobile SSH workspace keeps terminal space and exposes touch-only tools', async ({ page, context }) => {
  const sentFrames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') sentFrames.push(event.payload);
    });
  });
  const countStatusControls = (type: 'status.start' | 'status.stop') =>
    sentFrames.reduce((count, frame) => {
      try {
        const message = JSON.parse(frame) as { type?: string };
        return count + (message.type === type ? 1 : 0);
      } catch {
        return count;
      }
    }, 0);

  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const longFileFixture = await fetch(
    `${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(MOBILE_LONG_FILENAME)}`,
    {
      method: 'POST',
    },
  );
  expect(longFileFixture.ok).toBeTruthy();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  await step('terminal stays mounted instead of being collapsed by the mobile command bar', async () => {
    const terminal = page.getByTestId('terminal');
    const commandBar = page.getByTestId('command-input-bar');
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(commandBar).toBeVisible();
    const terminalBox = await terminal.boundingBox();
    const commandBarBox = await commandBar.boundingBox();
    expect(terminalBox).toBeTruthy();
    expect(commandBarBox).toBeTruthy();
    expect(terminalBox!.height).toBeGreaterThan(180);
    expect(commandBarBox!.height).toBeLessThan(100);
    expect(commandBarBox!.height).toBeLessThan(terminalBox!.height / 2);

    if (functionalScreenshotsEnabled()) {
      const commandInput = page.getByTestId('command-input');
      await commandInput.fill('clear');
      await commandInput.press('Enter');
      await commandInput.fill("printf 'Nexus mobile SSH\\n'");
      await commandInput.press('Enter');
      await expect
        .poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 15_000 })
        .toContain('Nexus mobile SSH');
      await captureFunctionalScreenshot(page, 'mobile-workspace.png');
    }
  });

  await slowStep('mobile status monitor opens and receives live SSH status samples', async () => {
    const startsBeforeOpen = countStatusControls('status.start');
    const stopsBeforeOpen = countStatusControls('status.stop');
    await page.getByRole('button', { name: 'Status Monitor', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Status Monitor', exact: true });
    await expect(modal).toBeVisible();
    await expect.poll(() => countStatusControls('status.start'), { timeout: 15_000 }).toBeGreaterThan(startsBeforeOpen);
    const monitor = modal.getByTestId('status-monitor');
    await expect(monitor).toContainText('Nexus Virtual CPU', { timeout: 15_000 });
    await expect(monitor).toContainText('CPU');
    await expect(monitor.getByText('Online', { exact: true })).toBeVisible();
    await expect(monitor.getByText('127.0.0.1', { exact: true })).toHaveCount(0);

    const viewport = page.viewportSize();
    const modalBox = await modal.boundingBox();
    expect(viewport).toBeTruthy();
    expect(modalBox).toBeTruthy();
    expect(modalBox!.x).toBeGreaterThanOrEqual(0);
    expect(modalBox!.y).toBeGreaterThanOrEqual(0);
    expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(modalBox!.y + modalBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
    await captureFunctionalScreenshot(page, 'mobile-status-monitor.png');

    await monitor.locator('.metric-cpu').click();
    const history = monitor.locator('.history-card');
    await expect(history).toBeVisible();
    const ranges = history.locator('.range-tabs');
    await expect(ranges.getByRole('button', { name: '1m', exact: true })).toBeVisible();
    await expect(ranges.getByRole('button', { name: '30m', exact: true })).toBeVisible();
    await ranges.getByRole('button', { name: '30m', exact: true }).click();
    await expect(ranges.getByRole('button', { name: '30m', exact: true })).toHaveClass(/active/);
    const historyBox = await history.boundingBox();
    expect(historyBox).toBeTruthy();
    expect(historyBox!.x).toBeGreaterThanOrEqual(modalBox!.x - 1);
    expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(modalBox!.x + modalBox!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport!.width);

    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toBeHidden();
    await expect.poll(() => countStatusControls('status.stop'), { timeout: 15_000 }).toBeGreaterThan(stopsBeforeOpen);

    const startsBeforeReopen = countStatusControls('status.start');
    await page.getByRole('button', { name: 'Status Monitor', exact: true }).click();
    await expect(modal).toBeVisible();
    await expect
      .poll(() => countStatusControls('status.start'), { timeout: 15_000 })
      .toBeGreaterThan(startsBeforeReopen);
    await expect(modal.getByTestId('status-monitor')).toContainText('Nexus Virtual CPU', { timeout: 15_000 });
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toBeHidden();
  });

  await slowStep('long press on a remote file opens the touch context menu', async () => {
    await openConnectedFileManager(page);
    const file = fileManagerRow(page, 'seed.txt');
    await expect(file.locator('.file-row-type')).toBeHidden();
    await expect(file.locator('.file-row-name-mobile-icon')).toBeVisible();
    await expect(file.locator('.file-row-name-button')).toHaveCSS('justify-content', 'flex-start');
    await expect(file.locator('.file-row-compact-meta')).toHaveCSS('justify-content', 'flex-end');
    await expect(file.locator('.file-row-compact-size')).toBeHidden();
    const compactGeometry = await file.evaluate((row) => {
      const name = row.querySelector<HTMLElement>('.file-row-name-button')?.getBoundingClientRect();
      const time = row.querySelector<HTMLElement>('.file-row-compact-meta')?.getBoundingClientRect();
      if (!name || !time) return null;
      return {
        nameLeft: name.left,
        nameRight: name.right,
        timeLeft: time.left,
        timeRight: time.right,
        timeWidth: time.width,
      };
    });
    expect(compactGeometry).toBeTruthy();
    expect(compactGeometry!.nameRight).toBeLessThanOrEqual(compactGeometry!.timeLeft + 0.5);
    expect(compactGeometry!.timeWidth).toBeGreaterThanOrEqual(123);
    expect(compactGeometry!.timeWidth).toBeLessThanOrEqual(125);

    const longNameRow = activeFileManagerList(page).locator(`tr[data-filename="${MOBILE_LONG_FILENAME}"]`).first();
    await expect(longNameRow).toBeVisible();
    const longNameGeometry = await longNameRow.evaluate((row) => {
      const label = row.querySelector<HTMLElement>('.file-row-name-label');
      const name = row.querySelector<HTMLElement>('.file-row-name-button')?.getBoundingClientRect();
      const time = row.querySelector<HTMLElement>('.file-row-compact-meta')?.getBoundingClientRect();
      if (!label || !name || !time) return null;
      return {
        labelClientWidth: label.clientWidth,
        labelScrollWidth: label.scrollWidth,
        nameRight: name.right,
        timeLeft: time.left,
        timeWidth: time.width,
      };
    });
    expect(longNameGeometry).toBeTruthy();
    expect(longNameGeometry!.labelScrollWidth).toBeGreaterThan(longNameGeometry!.labelClientWidth);
    expect(longNameGeometry!.nameRight).toBeLessThanOrEqual(longNameGeometry!.timeLeft + 0.5);
    expect(Math.abs(longNameGeometry!.timeWidth - compactGeometry!.timeWidth)).toBeLessThanOrEqual(0.5);
    await captureFunctionalScreenshot(page, 'mobile-file-manager.png');
    const box = await file.boundingBox();
    expect(box).toBeTruthy();
    const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await file.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    });
    await page.waitForTimeout(620);
    await file.dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: point.x,
      clientY: point.y,
    });
    const menu = page.getByTestId('file-manager-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Copy', { exact: true })).toBeVisible();
    await expect(menu.getByText('Rename', { exact: true })).toBeVisible();
  });
});
