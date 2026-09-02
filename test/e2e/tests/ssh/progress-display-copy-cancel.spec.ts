import { expect, test } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import {
  clickMenuItem,
  closeProgressDisplay,
  goIntoFolder,
  hiddenTask,
  openCurrentDirectoryContextMenu,
  openFileManager,
  openProgressDisplay,
  refreshFileManager,
  rightClickRow,
  row,
} from './progress-display.helpers';

test('copy cancellation survives an SFTP write stalled beyond the old cancellation TTL', async ({ page, context }) => {
  test.setTimeout(65_000);
  await openFileManager(page, context);
  const sourceName = 'cancel-marker-dir';
  await fetch(`${E2E_SSH.controlUrl}/fixture-directory?name=${encodeURIComponent(sourceName)}&size=${32 * 1024}`, { method: 'POST' });
  await refreshFileManager(page);
  await expect(row(page, sourceName)).toBeVisible();
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=34000`, { method: 'POST' });

  try {
    await rightClickRow(page, sourceName);
    await clickMenuItem(page, 'Copy');
    await goIntoFolder(page, 'folder-seed');
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'Paste');

    const popup = page.getByTestId('file-transfer-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await popup.getByTestId('file-transfer-progress-hide').click();
    const modal = await openProgressDisplay(page);
    const task = hiddenTask(modal, sourceName);
    await expect(task).toBeVisible();
    await task.getByTestId('hidden-progress-cancel').click();
    await closeProgressDisplay(modal);

    // Old code forgot cancellation after 30s. Keep the first write blocked beyond that
    // boundary, then make all later writes immediate so a resurrected copy is observable.
    await page.waitForTimeout(32_000);
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
    await page.waitForTimeout(4_000);

    const secondFile = await fetch(`${E2E_SSH.controlUrl}/path-exists?path=${encodeURIComponent(`folder-seed/${sourceName}/02-second.bin`)}`);
    expect(secondFile.ok).toBeTruthy();
    expect((await secondFile.json() as { exists: boolean }).exists).toBe(false);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
