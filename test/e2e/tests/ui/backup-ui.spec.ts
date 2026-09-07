import { readFile, stat, writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { slowStep, step } from '../../support/steps';

const BACKUP_MAGIC = 'NEXUS_TERMINAL_BACKUP_V1\n';

async function captureEvidence(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  name: string,
): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="data-management-settings"]');
    const panelRect = panel?.getBoundingClientRect();
    const overflowing = [...document.querySelectorAll('*')]
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        return {
          tag: htmlElement.tagName,
          testId: htmlElement.dataset.testid ?? '',
          className: htmlElement.className,
          text: (htmlElement.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
          x: rect.x,
          width: rect.width,
          right: rect.right,
          clientWidth: htmlElement.clientWidth,
          scrollWidth: htmlElement.scrollWidth,
        };
      })
      .filter((item) => item.right > window.innerWidth + 1 || item.scrollWidth > item.clientWidth + 1)
      .sort((left, right) => Math.max(right.right, right.scrollWidth) - Math.max(left.right, left.scrollWidth))
      .slice(0, 12);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
      panel: panelRect
        ? {
            x: panelRect.x,
            y: panelRect.y,
            width: panelRect.width,
            height: panelRect.height,
            right: panelRect.right,
            bottom: panelRect.bottom,
            clientWidth: panel?.clientWidth ?? 0,
            scrollWidth: panel?.scrollWidth ?? 0,
          }
        : null,
      overflowing,
    };
  });
  await writeFile(testInfo.outputPath(`backup-${name}.metrics.json`), JSON.stringify(metrics, null, 2));
  expect(metrics.panel).not.toBeNull();
  expect(metrics.page.scrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.panel?.right ?? 0).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.panel?.scrollWidth ?? 0).toBeLessThanOrEqual(metrics.panel?.clientWidth ?? 0);
  if (metrics.viewport.width <= 375) expect(metrics.page.scrollHeight).toBeGreaterThan(metrics.viewport.height);
}

test('data management UI exports a real backup file and imports it through the file picker', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Data Management', exact: true }).click();
  const section = page.getByTestId('data-management-settings');
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await captureEvidence(page, testInfo, 'before');
  await captureFunctionalScreenshot(page, 'data-backup-settings.png', { viewport: { width: 1280, height: 800 } });

  await page.setViewportSize({ width: 320, height: 667 });
  await section.scrollIntoViewIfNeeded();
  await captureEvidence(page, testInfo, 'narrow-320');
  await captureFunctionalScreenshot(page, 'data-backup-settings-narrow-320.png');

  await page.setViewportSize({ width: 375, height: 812 });
  await section.scrollIntoViewIfNeeded();
  await captureEvidence(page, testInfo, 'narrow-375');
  await captureFunctionalScreenshot(page, 'data-backup-settings-narrow-375.png');

  await page.setViewportSize({ width: 1280, height: 800 });
  await section.scrollIntoViewIfNeeded();

  let backupPath = '';
  await slowStep('export downloads a non-empty encrypted .nexus-backup file', async () => {
    await section.getByTestId('backup-export-password').fill(E2E_ADMIN.password);
    const downloadPromise = page.waitForEvent('download');
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/settings/backup/export') && response.request().method() === 'POST',
    );
    await section.getByTestId('backup-export').click();
    const download = await downloadPromise;
    expect((await responsePromise).ok()).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/\.nexus-backup$/);
    backupPath = (await download.path()) ?? '';
    expect(backupPath).not.toBe('');
    expect((await stat(backupPath)).size).toBeGreaterThan(100);
    const backup = await readFile(backupPath);
    expect(backup.subarray(0, BACKUP_MAGIC.length).toString('utf8')).toBe(BACKUP_MAGIC);
    const envelope = JSON.parse(backup.subarray(BACKUP_MAGIC.length).toString('utf8')) as {
      format?: string;
      version?: number;
      passwordKdf?: { algorithm?: string; iterations?: number };
      payload?: { iv?: string; ciphertext?: string; tag?: string };
    };
    expect(envelope).toMatchObject({
      format: 'nexus-terminal-backup',
      version: 1,
      passwordKdf: { algorithm: 'pbkdf2-sha256', iterations: 210_000 },
      payload: { iv: expect.any(String), ciphertext: expect.any(String), tag: expect.any(String) },
    });
    expect(envelope).not.toHaveProperty('tables');
  });

  await slowStep('import submits the downloaded backup through the real UI file picker', async () => {
    await section.getByTestId('backup-import-file').setInputFiles(backupPath);
    const importPromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/settings/backup/import') && response.request().method() === 'POST',
    );
    await section.getByTestId('backup-import').click();
    const response = await importPromise;
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { restoredRows?: number; restoredFiles?: number };
    expect(Number(body.restoredRows ?? 0)).toBeGreaterThanOrEqual(0);
    expect(Number(body.restoredFiles ?? 0)).toBeGreaterThanOrEqual(0);
    await expect(section).toContainText(/Backup imported: restored \d+ data rows and \d+ files\./);
  });

  await step('the browser remains authenticated after the import-triggered reload', async () => {
    await page.waitForTimeout(1_000);
    await page.waitForLoadState('domcontentloaded');
    const status = await context.request.get('/api/v1/auth/status');
    expect(status.ok()).toBeTruthy();
    await expect(status.json()).resolves.toMatchObject({ isAuthenticated: true });
    await page.getByRole('tab', { name: 'Data Management', exact: true }).click();
    const reloadedSection = page.getByTestId('data-management-settings');
    await expect(reloadedSection).toBeVisible();
    await reloadedSection.scrollIntoViewIfNeeded();
    await captureEvidence(page, testInfo, 'after');
    await captureFunctionalScreenshot(page, 'data-backup-restored.png', {
      viewport: { width: 1280, height: 800 },
    });
  });
});
