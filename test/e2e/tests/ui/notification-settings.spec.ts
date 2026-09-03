import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

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
    await page.locator('#webhook-url').fill('http://127.0.0.1:22223/e2e-notification-webhook');
    await page.locator('#webhook-method').selectOption('POST');
    await page.locator('#webhook-body').fill('{"event":"{event}"}');
    await page
      .locator('form')
      .filter({ has: page.locator('#setting-name') })
      .getByRole('button', { name: 'Save', exact: true })
      .click();

    const card = settings.locator('.grid.gap-4 > div').filter({ hasText: CHANNEL_NAME });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Webhook');
    await expect(card).toContainText('Enabled');
  });

  await step('edit the channel and persist the disabled state', async () => {
    const card = settings.locator('.grid.gap-4 > div').filter({ hasText: CHANNEL_NAME });
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
    const card = settings.locator('.grid.gap-4 > div').filter({ hasText: CHANNEL_NAME });
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
