import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const ORIGINAL_NAME = 'E2E Proxy Lifecycle';
const RENAMED_NAME = 'E2E Proxy Lifecycle Renamed';
const UPDATED_NAME = 'E2E Proxy Lifecycle Updated';
const CLEARED_NAME = 'E2E Proxy Lifecycle Cleared';

async function cleanup(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/proxies');
  expect(response.ok()).toBeTruthy();
  const proxies = await response.json() as Array<{ id: number; name: string }>;
  for (const proxy of proxies.filter((item) => [ORIGINAL_NAME, RENAMED_NAME, UPDATED_NAME, CLEARED_NAME].includes(item.name))) {
    const remove = await request.delete(`/api/v1/proxies/${proxy.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

test('proxy UI preserves, updates, and explicitly clears a stored password', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await cleanup(context.request);
  await page.goto('/proxies');

  let proxyId = 0;
  await step('create an authenticated proxy through the UI', async () => {
    await page.getByTestId('proxy-add-button').click();
    const form = page.getByTestId('proxy-form');
    await form.locator('#proxy-name').fill(ORIGINAL_NAME);
    await form.locator('#proxy-type').selectOption('HTTP');
    await form.locator('#proxy-host').fill('127.0.0.1');
    await form.locator('#proxy-port').fill('18080');
    await form.locator('#proxy-username').fill('proxy-user');
    await form.locator('#proxy-password').fill('proxy-password-v1');
    const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/proxies') && response.request().method() === 'POST');
    await form.getByTestId('proxy-submit').click();
    const create = await createPromise;
    expect(create.status()).toBe(201);
    proxyId = (await create.json() as { proxy: { id: number } }).proxy.id;
    await expect(page.getByTestId(`proxy-row-${proxyId}`)).toContainText(ORIGINAL_NAME);
  });

  await step('leaving password blank preserves the existing credential', async () => {
    const row = page.getByTestId(`proxy-row-${proxyId}`);
    await row.getByTestId('proxy-edit').click();
    const form = page.getByTestId('proxy-form');
    await expect(form.locator('#proxy-password')).toHaveValue('');
    await form.locator('#proxy-name').fill(RENAMED_NAME);
    const updatePromise = page.waitForRequest((request) => request.url().endsWith(`/api/v1/proxies/${proxyId}`) && request.method() === 'PUT');
    await form.getByTestId('proxy-submit').click();
    const updateRequest = await updatePromise;
    expect(updateRequest.postDataJSON()).toMatchObject({ name: RENAMED_NAME });
    expect(updateRequest.postDataJSON()).not.toHaveProperty('password');
    await expect(row).toContainText(RENAMED_NAME);
  });

  await step('typing a new password sends an explicit credential update', async () => {
    const row = page.getByTestId(`proxy-row-${proxyId}`);
    await row.getByTestId('proxy-edit').click();
    const form = page.getByTestId('proxy-form');
    await form.locator('#proxy-name').fill(UPDATED_NAME);
    await form.locator('#proxy-password').fill('proxy-password-v2');
    const updatePromise = page.waitForRequest((request) => request.url().endsWith(`/api/v1/proxies/${proxyId}`) && request.method() === 'PUT');
    await form.getByTestId('proxy-submit').click();
    expect((await updatePromise).postDataJSON()).toMatchObject({ name: UPDATED_NAME, password: 'proxy-password-v2' });
    await expect(row).toContainText(UPDATED_NAME);
  });

  await step('clear saved password is a separate explicit action', async () => {
    const row = page.getByTestId(`proxy-row-${proxyId}`);
    await row.getByTestId('proxy-edit').click();
    const form = page.getByTestId('proxy-form');
    await form.locator('#proxy-name').fill(CLEARED_NAME);
    await form.getByTestId('proxy-clear-password').check();
    const updatePromise = page.waitForRequest((request) => request.url().endsWith(`/api/v1/proxies/${proxyId}`) && request.method() === 'PUT');
    await form.getByTestId('proxy-submit').click();
    expect((await updatePromise).postDataJSON()).toMatchObject({ name: CLEARED_NAME, password: null });
    await expect(row).toContainText(CLEARED_NAME);
  });

  await step('delete removes the proxy from UI and persistence', async () => {
    const row = page.getByTestId(`proxy-row-${proxyId}`);
    await row.getByTestId('proxy-delete').click();
    const confirm = page.getByRole('dialog').filter({ hasText: CLEARED_NAME });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => {
      const response = await context.request.get('/api/v1/proxies');
      const proxies = await response.json() as Array<{ id: number }>;
      return proxies.some((item) => item.id === proxyId);
    }).toBeFalsy();
  });
});
