import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { slowStep, step } from '../../support/steps';

const CRUD_CHANNEL_NAME = 'E2E Notification CRUD Delivery';
const STRICT_WEBHOOK_URL = 'http://127.0.0.1:22223/e2e-notification-webhook-strict';
const FAILURE_WEBHOOK_URL = 'http://127.0.0.1:22223/e2e-notification-webhook-missing';

async function cleanupChannel(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/notifications');
  expect(response.ok()).toBeTruthy();
  const settings = (await response.json()) as Array<{ id: number; name: string }>;
  for (const setting of settings.filter((item) => item.name === CRUD_CHANNEL_NAME)) {
    const remove = await request.delete(`/api/v1/notifications/${setting.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

async function captureEvidence(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  name: 'before' | 'after',
): Promise<void> {
  const metrics = await page.evaluate(() => ({
    language: document.documentElement.lang,
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    pageScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    appBackground: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim(),
    headerBackground: getComputedStyle(document.documentElement).getPropertyValue('--header-bg-color').trim(),
  }));
  const screenshotPath = testInfo.outputPath(`notification-crud-delivery-${name}.png`);
  const metricsPath = testInfo.outputPath(`notification-crud-delivery-${name}.metrics.json`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await testInfo.attach(`M07.03-a ${name} screenshot`, { path: screenshotPath, contentType: 'image/png' });
  await testInfo.attach(`M07.03-a ${name} metrics`, { path: metricsPath, contentType: 'application/json' });
  console.log(
    `[M07.03-a ${name} metrics] language=${metrics.language} viewport=${metrics.viewport.width}x${metrics.viewport.height} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} appBackground=${metrics.appBackground} headerBackground=${metrics.headerBackground}`,
  );
  expect(metrics.language).toMatch(/^en(?:-US)?$/);
  expect(metrics.viewport).toEqual({ width: 1280, height: 800 });
  expect(metrics.appBackground).toBe('#ffffff');
  expect(metrics.headerBackground).toBe('#f0f0f0');
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
}

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

test('notification test localizes user-facing content while preserving the raw event id', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'zh-CN' } });
  expect(language.ok()).toBeTruthy();

  await page.goto('/notifications');
  const settings = page.getByTestId('notification-settings');
  await settings.getByTestId('notification-add-channel').click();
  await page.locator('#setting-name').fill('E2E Localized Webhook Delivery');
  await page.locator('#setting-channel-type').selectOption('webhook');
  await page.locator('#webhook-url').fill(`${STRICT_WEBHOOK_URL}?locale=zh-CN`);
  await page.locator('#webhook-method').selectOption('POST');
  await page.locator('#webhook-headers').fill('{"Content-Type":"application/json","X-E2E-Webhook":"delivery"}');
  await page
    .locator('#webhook-body')
    .fill('{"source":"nexus-e2e","event":"{event}","eventDisplay":"{eventDisplay}","details":{details}}');

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/notifications/test-unsaved') && response.request().method() === 'POST',
  );
  await page.getByTestId('notification-test').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const result = (await response.json()) as { success: boolean; message: string };
  expect(result).toEqual({ success: true, message: '测试通知发送成功。' });
  await expect(page.locator('small').filter({ hasText: '测试通知发送成功。' })).toBeVisible();
});

test('email notification test preserves legacy HTML body-template rendering', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();

  await page.goto('/notifications');
  const settings = page.getByTestId('notification-settings');
  await settings.getByTestId('notification-add-channel').click();
  await page.locator('#setting-name').fill('E2E HTML Email Delivery');
  await page.locator('#setting-channel-type').selectOption('email');
  const field = (label: string) => page.locator('label').filter({ hasText: label }).locator('..');
  await field('Recipient Email(s):').locator('input').fill('recipient@example.test');
  await field('Body Template (Optional)').locator('textarea').fill('<strong>NEXUS-E2E-HTML</strong> {eventDisplay}');
  await field('SMTP Host:').locator('input').fill('127.0.0.1');
  await field('SMTP Port:').locator('input').fill('22224');
  const secure = page.locator('label').filter({ hasText: 'Use TLS/SSL' }).locator('input[type=checkbox]');
  if (await secure.isChecked()) await secure.uncheck();
  await field('Sender Email:').locator('input').fill('nexus@example.test');

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/notifications/test-unsaved') && response.request().method() === 'POST',
  );
  await page.getByTestId('notification-test').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ success: true });
});

test('notification settings complete a real CRUD, event persistence, and delivery error loop', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', {
    data: { language: 'en-US', timezone: 'UTC' },
  });
  expect(language.ok()).toBeTruthy();
  await cleanupChannel(context.request);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'System', exact: true }).click();
  const preferences = page.getByTestId('preferences-settings');
  await expect(preferences.locator('#languageSelect')).toHaveValue('en-US');
  const languageSavePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
  );
  await preferences.locator('#languageSelect').selectOption('en-US');
  await preferences.locator('form').first().getByRole('button', { name: 'Save Language', exact: true }).click();
  expect((await languageSavePromise).ok()).toBeTruthy();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en-US');
  await page.goto('/notifications');
  const settings = page.getByTestId('notification-settings');
  await expect(settings).toBeVisible({ timeout: 20_000 });
  await captureEvidence(page, testInfo, 'before');

  await step('create an enabled webhook and select notification events', async () => {
    await settings.getByTestId('notification-add-channel').click();
    await page.locator('#setting-name').fill(CRUD_CHANNEL_NAME);
    await page.locator('#setting-channel-type').selectOption('webhook');
    await page.locator('#webhook-url').fill(STRICT_WEBHOOK_URL);
    await page.locator('#webhook-method').selectOption('POST');
    await page.locator('#webhook-headers').fill('{"Content-Type":"application/json","X-E2E-Webhook":"delivery"}');
    await page.locator('#webhook-body').fill('{"source":"nexus-e2e","event":"{event}","details":{details}}');
    await page.getByLabel('Login Success', { exact: true }).check();
    await page.getByLabel('SSH Connection Failed', { exact: true }).check();

    const createPromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/notifications') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const createResponse = await createPromise;
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as {
      id: number;
      enabled: boolean;
      enabledEvents: string[];
      config: Record<string, unknown>;
    };
    expect(created).toMatchObject({
      enabled: true,
      enabledEvents: ['LOGIN_SUCCESS', 'SSH_CONNECT_FAILURE'],
    });
    expect(created.config).toMatchObject({ url: STRICT_WEBHOOK_URL, method: 'POST' });

    const card = settings.locator('article').filter({ hasText: CRUD_CHANNEL_NAME });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Enabled');
    await expect(card).toContainText('Login Success');
    await expect(card).toContainText('SSH Connection Failed');
  });

  const card = settings.locator('article').filter({ hasText: CRUD_CHANNEL_NAME });
  await step('reload keeps enabled state and selected events persisted', async () => {
    await page.reload();
    await expect(settings).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Enabled');
    await expect(card).toContainText('Login Success');
    await expect(card).toContainText('SSH Connection Failed');
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#setting-enabled')).toBeChecked();
    await expect(page.getByLabel('Login Success', { exact: true })).toBeChecked();
    await expect(page.getByLabel('SSH Connection Failed', { exact: true })).toBeChecked();
  });

  await slowStep('saved test sends through the real strict webhook and shows success feedback', async () => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().match(/\/api\/v1\/notifications\/\d+\/test$/) !== null && response.request().method() === 'POST',
    );
    await page.getByTestId('notification-test').click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const result = (await response.json()) as { success: boolean; message: string };
    expect(result.success).toBeTruthy();
    const feedback = page.locator('small').filter({ hasText: /测试通知发送成功|Test notification sent successfully/i });
    await expect(feedback).toBeVisible({ timeout: 15_000 });
    await expect(feedback).not.toContainText(STRICT_WEBHOOK_URL);
  });

  await step('saved delivery errors stay visible without rewriting the channel', async () => {
    await page.locator('#webhook-url').fill(FAILURE_WEBHOOK_URL);
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().match(/\/api\/v1\/notifications\/\d+$/) !== null && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const updateResponse = await updatePromise;
    expect(updateResponse.ok()).toBeTruthy();

    const savedAfterUpdate = (await updateResponse.json()) as {
      enabled: boolean;
      enabledEvents: string[];
      config: Record<string, unknown>;
    };
    expect(savedAfterUpdate).toMatchObject({
      enabled: true,
      enabledEvents: ['LOGIN_SUCCESS', 'SSH_CONNECT_FAILURE'],
    });
    expect(savedAfterUpdate.config).toMatchObject({ url: FAILURE_WEBHOOK_URL });

    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().match(/\/api\/v1\/notifications\/\d+\/test$/) !== null && response.request().method() === 'POST',
    );
    await page.getByTestId('notification-test').click();
    const response = await responsePromise;
    expect(response.status()).toBe(400);
    const result = (await response.json()) as { success: boolean; message: string };
    expect(result.success).toBeFalsy();
    const feedback = page.locator('small').filter({ hasText: /测试通知发送失败|notification failed/i });
    await expect(feedback).toBeVisible({ timeout: 15_000 });
    await expect(feedback).toHaveClass(/text-error/);
    await expect(feedback).not.toContainText(FAILURE_WEBHOOK_URL);

    const persisted = await context.request.get('/api/v1/notifications');
    expect(persisted.ok()).toBeTruthy();
    const saved = (
      (await persisted.json()) as Array<{
        name: string;
        enabled: boolean;
        enabledEvents: string[];
        config: Record<string, unknown>;
      }>
    ).find((item) => item.name === CRUD_CHANNEL_NAME);
    expect(saved).toMatchObject({
      enabled: true,
      enabledEvents: ['LOGIN_SUCCESS', 'SSH_CONNECT_FAILURE'],
      config: { url: FAILURE_WEBHOOK_URL },
    });
  });

  await step('disable, reload, and delete the persisted channel', async () => {
    await page.locator('#setting-enabled').uncheck();
    const disablePromise = page.waitForResponse(
      (response) =>
        response.url().match(/\/api\/v1\/notifications\/\d+$/) !== null && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const disableResponse = await disablePromise;
    expect(disableResponse.ok()).toBeTruthy();
    await expect(card).toContainText('Disabled');

    const disabled = (await disableResponse.json()) as { enabled: boolean; enabledEvents: string[] };
    expect(disabled).toMatchObject({ enabled: false, enabledEvents: ['LOGIN_SUCCESS', 'SSH_CONNECT_FAILURE'] });

    await page.reload();
    await expect(settings).toBeVisible({ timeout: 20_000 });
    const reloadedCard = settings.locator('article').filter({ hasText: CRUD_CHANNEL_NAME });
    await expect(reloadedCard).toContainText('Disabled');
    await reloadedCard.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#setting-enabled')).not.toBeChecked();
    await expect(page.getByLabel('Login Success', { exact: true })).toBeChecked();
    await expect(page.getByLabel('SSH Connection Failed', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await reloadedCard.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: CRUD_CHANNEL_NAME });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(reloadedCard).toHaveCount(0);

    const remaining = await context.request.get('/api/v1/notifications');
    expect(remaining.ok()).toBeTruthy();
    expect(
      ((await remaining.json()) as Array<{ name: string }>).some((item) => item.name === CRUD_CHANNEL_NAME),
    ).toBeFalsy();
  });

  await expect(settings.getByText('No notification channels configured yet.', { exact: true })).toBeVisible();
  await captureEvidence(page, testInfo, 'after');

  await cleanupChannel(context.request);
});
