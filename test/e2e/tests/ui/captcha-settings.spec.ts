import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const HCAPTCHA_SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';

async function resetCaptcha(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const response = await request.put('/api/v1/settings/captcha', {
    data: {
      enabled: false,
      provider: 'none',
      hcaptchaSiteKey: '',
      hcaptchaSecretKey: '',
      recaptchaSiteKey: '',
      recaptchaSecretKey: '',
    },
  });
  expect(response.ok()).toBeTruthy();
}

test('CAPTCHA settings UI enables a provider, persists public configuration, and disables it again', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await resetCaptcha(context.request);

  try {
    await page.goto('/settings');
    await page.getByTestId('settings-tab-security').click();
    const captcha = page.getByTestId('captcha-settings');
    await expect(captcha).toBeVisible();

    await step('enable hCaptcha and save provider keys through the UI', async () => {
      await captcha.getByTestId('captcha-enabled').check();
      await captcha.getByTestId('captcha-provider').selectOption('hcaptcha');
      await captcha.locator('#hcaptchaSiteKey').fill(HCAPTCHA_SITE_KEY);
      await captcha.locator('#hcaptchaSecretKey').fill('e2e-hcaptcha-secret');
      const savePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'PUT');
      await captcha.getByTestId('captcha-save').click();
      expect((await savePromise).ok()).toBeTruthy();

      const publicConfig = await context.request.get('/api/v1/settings/captcha');
      expect(publicConfig.ok()).toBeTruthy();
      await expect(publicConfig.json()).resolves.toMatchObject({
        enabled: true,
        provider: 'hcaptcha',
        hcaptchaSiteKey: HCAPTCHA_SITE_KEY,
      });
    });

    await step('reload keeps the saved provider visible without exposing the secret', async () => {
      await page.reload();
      await page.getByTestId('settings-tab-security').click();
      const reloaded = page.getByTestId('captcha-settings');
      await expect(reloaded.getByTestId('captcha-enabled')).toBeChecked();
      await expect(reloaded.getByTestId('captcha-provider')).toHaveValue('hcaptcha');
      await expect(reloaded.locator('#hcaptchaSiteKey')).toHaveValue(HCAPTCHA_SITE_KEY);
      await expect(reloaded.locator('#hcaptchaSecretKey')).toHaveValue('');
    });

    await step('disable CAPTCHA through the UI and persist the safe default', async () => {
      const reloaded = page.getByTestId('captcha-settings');
      await reloaded.getByTestId('captcha-enabled').uncheck();
      const savePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'PUT');
      await reloaded.getByTestId('captcha-save').click();
      expect((await savePromise).ok()).toBeTruthy();
      const publicConfig = await context.request.get('/api/v1/settings/captcha');
      await expect(publicConfig.json()).resolves.toMatchObject({ enabled: false });
    });
  } finally {
    await resetCaptcha(context.request);
  }
});
