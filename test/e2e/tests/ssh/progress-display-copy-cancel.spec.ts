import { expect, test } from '../../support/fixtures';
import { reopenConnectedFileManager, E2E_SSH } from '../../support/ssh';
import {
  clickMenuItem,
  closeProgressDisplay,
  goIntoFolder,
  hideVisibleProgressCenter,
  hiddenTask,
  openCurrentDirectoryContextMenu,
  openFileManager,
  openProgressDisplay,
  refreshFileManager,
  rightClickRow,
  row,
} from './progress-display.helpers';

test('copy remains cancelled after a long remote write stall', async ({ page, context }) => {
  test.setTimeout(65_000);
  await openFileManager(page, context);
  const sourceName = 'cancel-marker-dir';
  await fetch(`${E2E_SSH.controlUrl}/fixture-directory?name=${encodeURIComponent(sourceName)}&size=${32 * 1024}`, {
    method: 'POST',
  });
  await refreshFileManager(page);
  await expect(row(page, sourceName)).toBeVisible();
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=34000`, { method: 'POST' });

  try {
    await rightClickRow(page, sourceName);
    await clickMenuItem(page, 'Copy');
    await goIntoFolder(page, 'folder-seed');
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'Paste');

    await expect(page.getByTestId('transfer-progress-center')).toBeVisible({ timeout: 10_000 });
    await hideVisibleProgressCenter(page);
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

    await reopenConnectedFileManager(page);
    await refreshFileManager(page);
    const partialDirectory = row(page, sourceName);
    if ((await partialDirectory.count()) > 0) {
      await partialDirectory.click();
      await expect(row(page, '02-second.bin')).toHaveCount(0);
    }
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
