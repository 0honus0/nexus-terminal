import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

const TEST_BLOCKED_IP = '198.51.100.24';

test('IP blacklist UI toggles protection and persists login-ban thresholds', async ({ page, context }, testInfo) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as {
    ipBlacklistEnabled?: boolean;
    maxLoginAttempts?: number;
    loginBanDuration?: number;
  };

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      ipBlacklistEnabled: true,
      maxLoginAttempts: 5,
      loginBanDuration: 300,
    },
  });
  expect(normalize.ok()).toBeTruthy();

  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
    const blacklist = page.getByTestId('ip-blacklist-settings');
    const toggle = blacklist.getByTestId('ip-blacklist-toggle');
    await expect(blacklist).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await blacklist.scrollIntoViewIfNeeded();
    const beforeMetrics = await blacklist.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('input,button')].map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        };
      });
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        page: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
        panel: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          right: box.right,
          bottom: box.bottom,
        },
        controls,
      };
    });
    await writeFile(testInfo.outputPath('ip-blacklist-before.metrics.json'), JSON.stringify(beforeMetrics, null, 2));
    await captureFunctionalScreenshot(page, 'm05-04d-ip-blacklist-before.png', {
      viewport: { width: 1440, height: 900 },
    });
    await page.setViewportSize({ width: 320, height: 667 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    await captureFunctionalScreenshot(page, 'm05-04d-ip-blacklist-before-narrow.png');
    await page.setViewportSize({ width: 1280, height: 720 });

    await step('disable and re-enable the blacklist switch through the UI', async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(blacklist.getByTestId('ip-blacklist-max-attempts')).toHaveCount(0);
      await expect(blacklist).toContainText('Disabled');
      await expect
        .poll(async () => {
          const settings = await context.request.get('/api/v1/settings');
          return ((await settings.json()) as { ipBlacklistEnabled?: boolean }).ipBlacklistEnabled;
        })
        .toBe(false);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(async () => {
          const settings = await context.request.get('/api/v1/settings');
          return ((await settings.json()) as { ipBlacklistEnabled?: boolean }).ipBlacklistEnabled;
        })
        .toBe(true);
    });

    await step('keep invalid blacklist thresholds local with visible validation errors', async () => {
      await blacklist.getByTestId('ip-blacklist-max-attempts').fill('');
      const invalidMaxResponse = page
        .waitForRequest((request) => request.url().endsWith('/api/v1/settings') && request.method() === 'PUT', {
          timeout: 1_000,
        })
        .catch(() => undefined);
      await blacklist.getByTestId('ip-blacklist-save').click();
      await expect(blacklist).toContainText('Max failed attempts must be a positive integer.');
      expect(await invalidMaxResponse).toBeUndefined();

      await blacklist.getByTestId('ip-blacklist-max-attempts').fill('5');
      await blacklist.getByTestId('ip-blacklist-ban-duration').fill('');
      const invalidDurationResponse = page
        .waitForRequest((request) => request.url().endsWith('/api/v1/settings') && request.method() === 'PUT', {
          timeout: 1_000,
        })
        .catch(() => undefined);
      await blacklist.getByTestId('ip-blacklist-save').click();
      await expect(blacklist).toContainText('Ban duration must be a positive integer (seconds).');
      expect(await invalidDurationResponse).toBeUndefined();
      await blacklist.getByTestId('ip-blacklist-ban-duration').fill('300');
    });

    await step('save login failure threshold and ban duration', async () => {
      await blacklist.getByTestId('ip-blacklist-max-attempts').fill('2');
      await blacklist.getByTestId('ip-blacklist-ban-duration').fill('420');
      await blacklist.getByTestId('ip-blacklist-save').click();
      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/settings');
          const data = (await response.json()) as { maxLoginAttempts?: number; loginBanDuration?: number };
          return [Number(data.maxLoginAttempts), Number(data.loginBanDuration)];
        })
        .toEqual([2, 420]);
    });

    await step('remove a real blocked IP through the UI confirmation flow', async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const failedLogin = await context.request.post('/api/v1/auth/login', {
          headers: { 'x-forwarded-for': TEST_BLOCKED_IP },
          data: { username: 'e2e-admin', password: 'not-the-password', rememberMe: false },
        });
        expect(failedLogin.status()).toBe(401);
      }
      const blocked = await context.request.get('/api/v1/settings/ip-blacklist');
      expect(blocked.ok()).toBeTruthy();
      await expect(blocked.json()).resolves.toMatchObject({
        entries: [expect.objectContaining({ ip: TEST_BLOCKED_IP, attempts: 2 })],
      });

      await page.reload();
      await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
      const reloaded = page.getByTestId('ip-blacklist-settings');
      const row = reloaded.locator('tbody tr').filter({ hasText: TEST_BLOCKED_IP });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Remove', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(TEST_BLOCKED_IP);
      const removePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/settings/ip-blacklist/${TEST_BLOCKED_IP}`) &&
          response.request().method() === 'DELETE',
      );
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
      expect((await removePromise).ok()).toBeTruthy();
      await expect(reloaded).toContainText('No IP addresses are currently in the blacklist.');
      const afterRemove = await context.request.get('/api/v1/settings/ip-blacklist');
      await expect(afterRemove.json()).resolves.toMatchObject({ entries: [] });
    });

    await step('reload keeps the saved blacklist thresholds visible', async () => {
      await page.reload();
      await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
      const reloaded = page.getByTestId('ip-blacklist-settings');
      await expect(reloaded.getByTestId('ip-blacklist-max-attempts')).toHaveValue('2');
      await expect(reloaded.getByTestId('ip-blacklist-ban-duration')).toHaveValue('420');
      await reloaded.scrollIntoViewIfNeeded();
      await captureFunctionalScreenshot(page, 'm05-04d-ip-blacklist-after.png', {
        viewport: { width: 1440, height: 900 },
      });
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: {
        ipBlacklistEnabled: original.ipBlacklistEnabled ?? true,
        maxLoginAttempts: original.maxLoginAttempts ?? 5,
        loginBanDuration: original.loginBanDuration ?? 300,
      },
    });
    expect(restore.ok()).toBeTruthy();
    await context.request.delete(`/api/v1/settings/ip-blacklist/${TEST_BLOCKED_IP}`).catch(() => undefined);
  }
});
