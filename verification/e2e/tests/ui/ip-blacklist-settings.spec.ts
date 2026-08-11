import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

test('IP blacklist UI toggles protection and persists login-ban thresholds', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json() as Record<string, string | undefined>;

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      ipBlacklistEnabled: 'true',
      maxLoginAttempts: '5',
      loginBanDuration: '300',
    },
  });
  expect(normalize.ok()).toBeTruthy();

  try {
    await page.goto('/settings');
    await page.getByTestId('settings-tab-ipControl').click();
    const blacklist = page.getByTestId('ip-blacklist-settings');
    const toggle = blacklist.getByTestId('ip-blacklist-toggle');
    await expect(blacklist).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await step('disable and re-enable the blacklist switch through the UI', async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      let settings = await context.request.get('/api/v1/settings');
      expect((await settings.json() as Record<string, string>).ipBlacklistEnabled).toBe('false');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      settings = await context.request.get('/api/v1/settings');
      expect((await settings.json() as Record<string, string>).ipBlacklistEnabled).toBe('true');
    });

    await step('save login failure threshold and ban duration', async () => {
      await blacklist.getByTestId('ip-blacklist-max-attempts').fill('7');
      await blacklist.getByTestId('ip-blacklist-ban-duration').fill('420');
      await blacklist.getByTestId('ip-blacklist-save').click();
      await expect.poll(async () => {
        const response = await context.request.get('/api/v1/settings');
        const data = await response.json() as Record<string, string>;
        return `${data.maxLoginAttempts}:${data.loginBanDuration}`;
      }).toBe('7:420');
    });

    await step('reload keeps the saved blacklist thresholds visible', async () => {
      await page.reload();
      await page.getByTestId('settings-tab-ipControl').click();
      const reloaded = page.getByTestId('ip-blacklist-settings');
      await expect(reloaded.getByTestId('ip-blacklist-max-attempts')).toHaveValue('7');
      await expect(reloaded.getByTestId('ip-blacklist-ban-duration')).toHaveValue('420');
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: {
        ipBlacklistEnabled: original.ipBlacklistEnabled ?? 'true',
        maxLoginAttempts: original.maxLoginAttempts ?? '5',
        loginBanDuration: original.loginBanDuration ?? '300',
      },
    });
    expect(restore.ok()).toBeTruthy();
  }
});
