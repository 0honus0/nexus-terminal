import { expect, test } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import { menu, openFileManager, refreshFileManager, rightClickRow, row } from './progress-display.helpers';

test('archive remains cancelled while remote command preparation is stalled', async ({ page, context }) => {
  test.setTimeout(75_000);
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=1`, { method: 'POST' });

  try {
    await rightClickRow(page, 'archive-source.txt');
    const compress = menu(page)
      .locator('li')
      .filter({ hasText: /^Compress/ })
      .first();
    await compress.hover();
    await page.getByText('Compress to zip', { exact: true }).click();

    const popup = page.getByTestId('archive-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await popup.locator('.stop-button').click();
    await expect(popup).toBeHidden({ timeout: 10_000 });

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
