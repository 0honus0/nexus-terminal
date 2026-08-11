import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step, slowStep } from '../../support/steps';

test('mobile SSH workspace keeps terminal space and exposes touch-only tools', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
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
  });

  await slowStep('mobile status monitor opens and receives live SSH status samples', async () => {
    await page.getByTestId('open-status-monitor-button').click();
    const modal = page.getByTestId('status-monitor-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('status-monitor')).toContainText('Nexus E2E Linux', { timeout: 15_000 });
    await expect(modal.getByTestId('status-monitor')).toContainText('CPU');
    await modal.locator('button').first().click();
    await expect(modal).toBeHidden();
  });

  await slowStep('long press on a remote file opens the touch context menu', async () => {
    await openConnectedFileManager(page);
    const file = page.locator('tr[data-filename="seed.txt"]');
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
