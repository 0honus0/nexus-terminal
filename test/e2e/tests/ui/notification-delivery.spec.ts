import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { slowStep } from '../../support/steps';

test('notification test button performs a real webhook POST with configured headers and body', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();
  await page.goto('/notifications');
  const settings = page.getByTestId('notification-settings');
  await settings.getByTestId('notification-add-channel').click();
  await page.locator('#setting-name').fill('E2E Unsaved Webhook Delivery');
  await page.locator('#setting-channel-type').selectOption('webhook');
  await page.locator('#webhook-url').fill('http://127.0.0.1:22223/e2e-notification-webhook-strict');
  await page.locator('#webhook-method').selectOption('POST');
  await page.locator('#webhook-headers').fill('{"Content-Type":"application/json","X-E2E-Webhook":"delivery"}');
  await page.locator('#webhook-body').fill('{"source":"nexus-e2e","event":"{event}","details":{details}}');

  await slowStep(
    'test notification reaches the local webhook receiver through the real backend processor',
    async () => {
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/notifications/test-unsaved') && response.request().method() === 'POST',
      );
      await page.getByTestId('notification-test').click();
      expect((await responsePromise).ok()).toBeTruthy();
    },
  );
});
