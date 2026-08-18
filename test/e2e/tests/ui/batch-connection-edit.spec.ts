import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH } from '../../support/ssh';
import { step } from '../../support/steps';

const NAMES = ['E2E Batch SSH A', 'E2E Batch SSH B'];
const NOTES = 'updated-by-batch-e2e';

async function cleanup(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const items = await response.json() as Array<{ id: number; name?: string }>;
  for (const item of items.filter((connection) => NAMES.includes(connection.name ?? ''))) {
    expect((await request.delete(`/api/v1/connections/${item.id}`)).ok()).toBeTruthy();
  }
}

async function createConnection(request: APIRequestContext, name: string): Promise<number> {
  const response = await request.post('/api/v1/connections', {
    data: {
      name,
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

test('batch connection edit applies one advanced change to multiple saved connections', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await cleanup(context.request);
  const ids = [await createConnection(context.request, NAMES[0]), await createConnection(context.request, NAMES[1])];

  try {
    await page.goto('/connections');

    await step('select two connections in batch mode', async () => {
      await page.getByTestId('batch-edit-toggle').click();
      await expect(page.getByTestId('batch-edit-toggle')).toHaveAttribute('aria-checked', 'true');
      for (const id of ids) await page.getByTestId(`connection-row-${id}`).click();
      await expect(page.getByTestId('batch-edit-selected')).toBeEnabled();
    });

    await step('batch edit writes the same notes to both connections', async () => {
      await page.getByTestId('batch-edit-selected').click();
      const modal = page.getByTestId('batch-edit-modal');
      await expect(modal).toBeVisible();
      await modal.getByTestId('batch-edit-advanced-toggle').check();
      await modal.locator('#batch-notes').fill(NOTES);
      await modal.getByTestId('batch-edit-save').click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      for (const id of ids) {
        await expect.poll(async () => {
          const response = await context.request.get(`/api/v1/connections/${id}`);
          if (!response.ok()) return '';
          return (await response.json() as { notes?: string }).notes ?? '';
        }).toBe(NOTES);
      }
    });
  } finally {
    await cleanup(context.request);
  }
});
