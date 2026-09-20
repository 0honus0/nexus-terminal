import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';
import { E2E_SSH } from '../../support/ssh';

const CHANNEL_NAME = 'E2E Webhook Channel';

async function cleanupChannel(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/notifications');
  expect(response.ok()).toBeTruthy();
  const settings = (await response.json()) as Array<{ id: number; name: string }>;
  for (const setting of settings.filter((item) => item.name === CHANNEL_NAME)) {
    const remove = await request.delete(`/api/v1/notifications/${setting.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

test('notification settings create, edit, persist, and delete a webhook channel through the UI', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();
  await cleanupChannel(context.request);
  await page.goto('/notifications');

  const settings = page.getByTestId('notification-settings');
  await expect(settings).toBeVisible({ timeout: 20_000 });

  await step('add a webhook notification channel', async () => {
    await settings.getByTestId('notification-add-channel').click();
    await page.locator('#setting-name').fill(CHANNEL_NAME);
    await page.locator('#setting-channel-type').selectOption('webhook');
    await page.locator('#webhook-url').fill(`${E2E_SSH.controlUrl}/e2e-notification-webhook`);
    await page.locator('#webhook-method').selectOption('POST');
    await page.locator('#webhook-body').fill('{"event":"{event}"}');
    await page
      .locator('form')
      .filter({ has: page.locator('#setting-name') })
      .getByRole('button', { name: 'Save', exact: true })
      .click();

    const card = settings.locator('article').filter({ hasText: CHANNEL_NAME });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Webhook');
    await expect(card).toContainText('Enabled');
  });

  await step('edit the channel and persist the disabled state', async () => {
    const card = settings.locator('article').filter({ hasText: CHANNEL_NAME });
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#setting-name')).toHaveValue(CHANNEL_NAME);
    await page.locator('#setting-enabled').uncheck();
    await page
      .locator('form')
      .filter({ has: page.locator('#setting-name') })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(card).toContainText('Disabled');

    const response = await context.request.get('/api/v1/notifications');
    expect(response.ok()).toBeTruthy();
    const saved = ((await response.json()) as Array<{ name: string; enabled: boolean }>).find(
      (item) => item.name === CHANNEL_NAME,
    );
    expect(saved).toMatchObject({ name: CHANNEL_NAME, enabled: false });
  });

  await step('delete the channel and remove it from persistent settings', async () => {
    const card = settings.locator('article').filter({ hasText: CHANNEL_NAME });
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: CHANNEL_NAME });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(card).toHaveCount(0);

    const response = await context.request.get('/api/v1/notifications');
    expect(response.ok()).toBeTruthy();
    expect(((await response.json()) as Array<{ name: string }>).some((item) => item.name === CHANNEL_NAME)).toBeFalsy();
  });
});

test('notification settings keep long provider and event content readable on a narrow screen', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();

  const longName = 'E2E Notification Channel With An Extremely Long Narrow Screen Name';
  const longUrl = `${E2E_SSH.controlUrl}/e2e-notification-provider-with-a-long-path-for-mobile-readability`;
  const create = await context.request.post('/api/v1/notifications', {
    data: {
      channelType: 'webhook',
      name: longName,
      enabled: true,
      config: {
        url: longUrl,
        method: 'POST',
        headers: { 'X-E2E-Long-Header': 'narrow' },
        bodyTemplate: '{"event":"{event}","details":{details}}',
      },
      enabledEvents: [
        'LOGIN_SUCCESS',
        'PASSKEY_AUTH_SUCCESS',
        'NOTIFICATION_SETTING_UPDATED',
        'SSH_CONNECT_FAILURE',
        'ADMIN_SETUP_COMPLETE',
      ],
    },
  });
  expect(create.status()).toBe(201);
  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto('/notifications');
  const settings = page.getByTestId('notification-settings');
  const card = settings.locator('article').filter({ hasText: longName });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('notifications-narrow-after.png'), fullPage: true });

  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    appBackground: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim(),
  }));
  console.log(
    `[M07.02-a metrics] card viewport=${metrics.viewportWidth} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} appBackground=${metrics.appBackground}`,
  );
  expect(metrics.appBackground).toBe('#ffffff');
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  await expect(card.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#webhook-url')).toHaveValue(longUrl);
  await expect(page.locator('#webhook-body')).toBeVisible();
  await expect(page.locator('#setting-name')).toHaveValue(longName);
  const editMetrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const form = document.querySelector('form');
    const save = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save',
    );
    const saveRect = save?.getBoundingClientRect();
    const labels = Array.from(form?.querySelectorAll('label') ?? []).map(
      (label) => label.getBoundingClientRect().right,
    );
    return {
      viewportWidth,
      pageScrollHeight: document.scrollingElement?.scrollHeight ?? 0,
      pageClientHeight: document.scrollingElement?.clientHeight ?? 0,
      maxLabelRight: labels.length ? Math.max(...labels) : 0,
      saveRight: saveRect?.right ?? 0,
    };
  });
  console.log(
    `[M07.02-a edit metrics] scrollHeight=${editMetrics.pageScrollHeight} clientHeight=${editMetrics.pageClientHeight} maxLabelRight=${editMetrics.maxLabelRight} saveRight=${editMetrics.saveRight}`,
  );
  expect(editMetrics.pageScrollHeight).toBeGreaterThan(editMetrics.pageClientHeight);
  expect(editMetrics.maxLabelRight).toBeLessThanOrEqual(editMetrics.viewportWidth);
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0));
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('notifications-narrow-edit-after.png'), fullPage: true });
});

test('notification settings empty and error states stay within a narrow viewport', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();
  const settingsResponse = await context.request.get('/api/v1/notifications');
  expect(settingsResponse.ok()).toBeTruthy();
  for (const setting of (await settingsResponse.json()) as Array<{ id: number }>) {
    const remove = await context.request.delete(`/api/v1/notifications/${setting.id}`);
    expect(remove.ok()).toBeTruthy();
  }

  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto('/notifications');
  const settings = page.getByTestId('notification-settings');
  await expect(settings.getByText('No notification channels configured yet.', { exact: true })).toBeVisible();
  const emptyMetrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(emptyMetrics.pageScrollWidth).toBeLessThanOrEqual(emptyMetrics.viewportWidth);

  await page.route('**/api/v1/notifications', (route) => route.abort('failed'));
  await page.reload();
  await expect(settings.getByText('Network Error', { exact: true })).toBeVisible();
  const errorMetrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(errorMetrics.pageScrollWidth).toBeLessThanOrEqual(errorMetrics.viewportWidth);
});
