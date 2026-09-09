import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

const WHITELIST = '127.0.0.1\n10.0.0.0/8\n192.168.0.0/16';

test('IP whitelist UI saves and reloads the configured allow-list without enabling access control', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as Record<string, string | undefined>;

  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
    const whitelist = page.getByTestId('ip-whitelist-settings');
    await expect(whitelist).toBeVisible();
    await whitelist.scrollIntoViewIfNeeded();
    const beforeMetrics = await whitelist.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const input = element.querySelector('textarea')?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        page: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        panel: { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom },
        input: input
          ? {
              x: input.x,
              y: input.y,
              width: input.width,
              height: input.height,
              right: input.right,
              bottom: input.bottom,
            }
          : null,
      };
    });
    await writeFile(testInfo.outputPath('ip-whitelist-before.metrics.json'), JSON.stringify(beforeMetrics, null, 2));
    await captureFunctionalScreenshot(page, 'security-ip-whitelist-settings.png', {
      viewport: { width: 1440, height: 900 },
    });
    await page.setViewportSize({ width: 320, height: 667 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    await captureFunctionalScreenshot(page, 'security-ip-whitelist-settings-narrow.png');
    await page.setViewportSize({ width: 1280, height: 720 });

    await step('save a multi-line whitelist through the IP control UI', async () => {
      await whitelist.getByTestId('ip-whitelist-input').fill(WHITELIST);
      const responsePromise = page.waitForResponse((response) => {
        if (!response.url().endsWith('/api/v1/settings') || response.request().method() !== 'PUT') return false;
        try {
          const body = response.request().postDataJSON() as { ipWhitelist?: unknown };
          return body.ipWhitelist === WHITELIST;
        } catch {
          return false;
        }
      });
      await whitelist.getByTestId('ip-whitelist-save').click();
      expect((await responsePromise).ok()).toBeTruthy();
      await expect(whitelist).toContainText('IP whitelist saved successfully.');
      const persisted = await context.request.get('/api/v1/settings');
      expect(((await persisted.json()) as Record<string, string>).ipWhitelist).toBe(WHITELIST);
    });

    await step('reload keeps the saved whitelist visible', async () => {
      await page.reload();
      await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
      await expect(page.getByTestId('ip-whitelist-input')).toHaveValue(WHITELIST);
    });

    await step('clear the whitelist through the UI and persist the empty allow-list', async () => {
      const reloadedWhitelist = page.getByTestId('ip-whitelist-settings');
      await reloadedWhitelist.getByTestId('ip-whitelist-input').fill('');
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await reloadedWhitelist.getByTestId('ip-whitelist-save').click();
      expect((await responsePromise).ok()).toBeTruthy();
      await expect(reloadedWhitelist).toContainText('IP whitelist saved successfully.');
      const persisted = await context.request.get('/api/v1/settings');
      expect(((await persisted.json()) as Record<string, string>).ipWhitelist).toBe('');
      await page.reload();
      await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
      await expect(page.getByTestId('ip-whitelist-input')).toHaveValue('');
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: { ipWhitelist: original.ipWhitelist ?? '' },
    });
    expect(restore.ok()).toBeTruthy();
  }
});
