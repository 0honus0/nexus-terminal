import { stat } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { slowStep, step } from '../../support/steps';

test('data management UI exports a real backup file and imports it through the file picker', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await page.goto('/settings');
  await page.getByTestId('settings-tab-dataManagement').click();
  const section = page.getByTestId('data-management-settings');
  await expect(section).toBeVisible();

  let backupPath = '';
  await slowStep('export downloads a non-empty encrypted .nexus-backup file', async () => {
    await section.getByTestId('backup-export-password').fill(E2E_ADMIN.password);
    const downloadPromise = page.waitForEvent('download');
    await section.getByTestId('backup-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.nexus-backup$/);
    backupPath = (await download.path()) ?? '';
    expect(backupPath).not.toBe('');
    expect((await stat(backupPath)).size).toBeGreaterThan(100);
  });

  await slowStep('import submits the downloaded backup through the real UI file picker', async () => {
    await section.getByTestId('backup-import-file').setInputFiles(backupPath);
    const importPromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/settings/backup/import') && response.request().method() === 'POST');
    await section.getByTestId('backup-import').click();
    const response = await importPromise;
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { restoredRows?: number; restoredFiles?: number };
    expect(Number(body.restoredRows ?? 0)).toBeGreaterThanOrEqual(0);
    expect(Number(body.restoredFiles ?? 0)).toBeGreaterThanOrEqual(0);
  });

  await step('the browser remains authenticated after the import-triggered reload', async () => {
    await page.waitForTimeout(1_000);
    await page.waitForLoadState('domcontentloaded');
    const status = await context.request.get('/api/v1/auth/status');
    expect(status.ok()).toBeTruthy();
    await expect(status.json()).resolves.toMatchObject({ isAuthenticated: true });
  });
});
