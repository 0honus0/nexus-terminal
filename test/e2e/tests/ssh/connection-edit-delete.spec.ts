import { expect, test, type APIRequestContext } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, configureSshE2eSettings } from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const ORIGINAL_NAME = 'E2E SSH Lifecycle';
const EDITED_NAME = 'E2E SSH Lifecycle Edited';

async function cleanupConnections(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const items = await response.json() as Array<{ id: number; name?: string }>;
  for (const item of items.filter((connection) => connection.name === ORIGINAL_NAME || connection.name === EDITED_NAME)) {
    const remove = await request.delete(`/api/v1/connections/${item.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

async function createConnection(request: APIRequestContext): Promise<number> {
  const response = await request.post('/api/v1/connections', {
    data: {
      name: ORIGINAL_NAME,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      auth_method: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { connection: { id: number } }).connection.id;
}

test('saved SSH connection can be tested, renamed without re-entering password, retested, and deleted through UI', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await cleanupConnections(context.request);
  const connectionId = await createConnection(context.request);
  await page.goto('/connections');

  const row = page.getByTestId(`connection-row-${connectionId}`);
  await expect(row).toContainText(ORIGINAL_NAME);

  await slowStep('saved connection test reaches the real SSH server', async () => {
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/connections/${connectionId}/test`) && response.request().method() === 'POST',
    );
    await row.getByTestId('connection-row-test').click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  await step('edit changes only the name and leaves the stored password untouched', async () => {
    await row.getByTestId('connection-row-edit').click();
    const form = page.getByTestId('connection-form');
    await expect(form).toBeVisible();
    await expect(form.locator('#conn-name')).toHaveValue(ORIGINAL_NAME);
    await expect(form.locator('#conn-password')).toHaveValue('');
    await form.locator('#conn-name').fill(EDITED_NAME);

    const updatePromise = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/connections/${connectionId}`) && response.request().method() === 'PUT',
    );
    await form.getByTestId('connection-submit-button').click();
    const update = await updatePromise;
    expect(update.ok()).toBeTruthy();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect(row).toContainText(EDITED_NAME);
  });

  await slowStep('connection still authenticates after the name-only edit', async () => {
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/connections/${connectionId}/test`) && response.request().method() === 'POST',
    );
    await row.getByTestId('connection-row-test').click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  await step('delete from the edit form removes the connection from UI and persistence', async () => {
    await row.getByTestId('connection-row-edit').click();
    const form = page.getByTestId('connection-form');
    await form.getByTestId('connection-delete-button').click();
    const confirm = page.getByRole('dialog').filter({ hasText: EDITED_NAME });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });

    await expect.poll(async () => {
      const response = await context.request.get('/api/v1/connections');
      if (!response.ok()) return true;
      const items = await response.json() as Array<{ id: number }>;
      return items.some((item) => item.id === connectionId);
    }).toBeFalsy();
  });
});
