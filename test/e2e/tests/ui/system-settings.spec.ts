import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

const TARGET_TIMEZONE = 'Asia/Shanghai';
const TARGET_LANGUAGE = 'zh-CN';

test('system settings persist timezone and language changes through the UI', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json() as Record<string, string | undefined>;

  const normalize = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      timezone: 'UTC',
    },
  });
  expect(normalize.ok()).toBeTruthy();

  try {
    await page.goto('/settings');
    await page.getByTestId('settings-tab-system').click();
    await expect(page.locator('#languageSelect')).toBeVisible();
    await expect(page.locator('#timezoneSelect')).toBeVisible();
    await captureFunctionalScreenshot(page, 'system-settings.png', { viewport: { width: 1440, height: 900 } });

    await step('save a timezone through the system settings form', async () => {
      const timezone = page.locator('#timezoneSelect');
      const timezoneForm = page.locator('form').filter({ has: timezone });
      await timezone.selectOption(TARGET_TIMEZONE);

      const responsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await timezoneForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      expect((await persisted.json() as Record<string, string>).timezone).toBe(TARGET_TIMEZONE);
    });

    await step('save a language through the system settings form', async () => {
      const language = page.locator('#languageSelect');
      const languageForm = page.locator('form').filter({ has: language });
      await language.selectOption(TARGET_LANGUAGE);

      const responsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await languageForm.locator('button[type="submit"]').click();
      expect((await responsePromise).ok()).toBeTruthy();
      await expect(language).toHaveValue(TARGET_LANGUAGE);

      const persisted = await context.request.get('/api/v1/settings');
      expect(persisted.ok()).toBeTruthy();
      expect((await persisted.json() as Record<string, string>).language).toBe(TARGET_LANGUAGE);
    });

    await step('both values survive a full settings page reload', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('settings-tab-system').click();
      await expect(page.locator('#timezoneSelect')).toHaveValue(TARGET_TIMEZONE);
      await expect(page.locator('#languageSelect')).toHaveValue(TARGET_LANGUAGE);
    });
  } finally {
    const restore = await context.request.put('/api/v1/settings', {
      data: {
        language: original.language ?? 'en-US',
        timezone: original.timezone ?? 'UTC',
      },
    });
    expect(restore.ok()).toBeTruthy();
  }
});
