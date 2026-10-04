import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';

test.use({
  viewport: { width: 1180, height: 820 },
  hasTouch: true,
  isMobile: false,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});

test('wide desktop-UA touch Pad cancels moved file holds and preserves touch and mouse menus', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
  await openConnectedFileManager(page);
  const row = fileManagerRow(page, 'archive-source.txt');
  const box = await row.boundingBox();
  expect(box).toBeTruthy();
  const pointer = {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: box!.x + 80,
    clientY: box!.y + box!.height / 2,
  };
  // Advance the real gesture timer deterministically; no wall-clock sleep.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  for (const cancel of ['move', 'pointercancel'] as const) {
    await row.dispatchEvent('pointerdown', pointer);
    if (cancel === 'move') await row.dispatchEvent('pointermove', { ...pointer, clientY: pointer.clientY + 60 });
    else await row.dispatchEvent('pointercancel', pointer);
    await page.clock.runFor(600);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await row.dispatchEvent('pointerup', { ...pointer, buttons: 0 });
  }
  await row.dispatchEvent('pointerdown', pointer);
  await page.clock.runFor(600);
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Compress to zip', exact: true })).toBeVisible();
  await row.dispatchEvent('pointerup', { ...pointer, buttons: 0 });
  await row.locator('button[data-file-path]').dispatchEvent('click');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'File Manager', exact: true })).toBeVisible();
  await page.clock.runFor(600);
  await menu.getByRole('button', { name: 'Compress to zip', exact: true }).click();
  await page.clock.resume();
  await expect(fileManagerRow(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });
  await row.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button').filter({ hasText: 'Rename' }).first()).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(1);
});
