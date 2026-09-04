import { expect, test } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import {
  openFileManager,
  refreshFileManager,
  row,
  startZipCompression,
  visibleProgressCenter,
  visibleProgressTask,
} from './progress-display.helpers';

test('archive remains cancelled while remote command preparation is stalled', async ({ page, context }) => {
  test.setTimeout(75_000);
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=1`, { method: 'POST' });

  try {
    await startZipCompression(page, 'archive-source.txt');

    const popup = visibleProgressCenter(page);
    const task = visibleProgressTask(page, 'archive-source.zip');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await task.getByTestId('transfer-progress-cancel').click();
    await expect(task).toHaveAttribute('data-task-status', 'cancelled', { timeout: 10_000 });

    // A prolonged remote preflight must not be allowed to forget the user's cancellation
    // before the server eventually becomes responsive again.
    await page.waitForTimeout(31_500);
    await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=0`, { method: 'POST' });
    await page.waitForTimeout(4_000);

    await refreshFileManager(page);
    await expect(row(page, 'archive-source.zip')).toHaveCount(0);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=0`, { method: 'POST' });
  }
});
