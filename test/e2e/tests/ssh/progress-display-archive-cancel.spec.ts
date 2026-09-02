import { expect, test } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import {
  menu,
  openFileManager,
  remoteFileExists,
  rightClickRow,
} from './progress-display.helpers';

test('archive cancellation remains authoritative while command preflight is stalled beyond the old marker TTL', async ({ page, context }) => {
  test.setTimeout(75_000);
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=1`, { method: 'POST' });

  try {
    await rightClickRow(page, 'archive-source.txt');
    const compress = menu(page).locator('li').filter({ hasText: /^Compress/ }).first();
    await compress.hover();
    await page.getByText('Compress to zip', { exact: true }).click();

    const popup = page.getByTestId('archive-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await popup.locator('.stop-button').click();
    await expect(popup).toBeHidden({ timeout: 10_000 });

    // The production cancellation marker currently expires after 30 seconds. A stalled
    // preflight must not be allowed to "forget" the user's cancellation after that TTL.
    await page.waitForTimeout(31_500);
    await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=0`, { method: 'POST' });
    await page.waitForTimeout(4_000);

    expect(await remoteFileExists('archive-source.zip')).toBe(false);
    const commandsResponse = await fetch(`${E2E_SSH.controlUrl}/commands`);
    expect(commandsResponse.ok).toBeTruthy();
    const commandsBody = await commandsResponse.json() as { commands: string[] };
    expect(commandsBody.commands.some(command => command.includes('__NEXUS_ARCHIVE_TOTAL__:'))).toBe(false);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=0`, { method: 'POST' });
  }
});
