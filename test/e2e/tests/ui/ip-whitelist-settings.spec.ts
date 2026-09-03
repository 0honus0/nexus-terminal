import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const WHITELIST = '127.0.0.1\n10.0.0.0/8\n192.168.0.0/16';

test('IP whitelist UI saves and reloads the configured allow-list without enabling access control', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as Record<string, string | undefined>;

  try {
    await page.goto('/settings');
    await page.getByTestId('settings-tab-ipControl').click();
    const whitelist = page.getByTestId('ip-whitelist-settings');
    await expect(whitelist).toBeVisible();

    await step('save a multi-line whitelist through the IP control UI', async () => {
      await whitelist.getByTestId('ip-whitelist-input').fill(WHITELIST);
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await whitelist.getByTestId('ip-whitelist-save').click();
      expect((await responsePromise).ok()).toBeTruthy();
      const persisted = await context.request.get('/api/v1/settings');
      expect(((await persisted.json()) as Record<string, string>).ipWhitelist).toBe(WHITELIST);
    });

    await step('reload keeps the saved whitelist visible', async () => {
      await page.reload();
      await page.getByTestId('settings-tab-ipControl').click();
      await expect(page.getByTestId('ip-whitelist-input')).toHaveValue(WHITELIST);
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: { ipWhitelist: original.ipWhitelist ?? '' },
    });
    expect(restore.ok()).toBeTruthy();
  }
});
