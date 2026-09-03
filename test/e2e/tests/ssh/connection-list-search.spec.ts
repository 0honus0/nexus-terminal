import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

const SECONDARY_NAME = 'E2E Search Secondary';
const SECONDARY_HOST = 'search-target.invalid';

async function recreateSecondaryConnection(request: APIRequestContext): Promise<number> {
  const list = await request.get('/api/v1/connections');
  expect(list.ok()).toBeTruthy();
  const connections = (await list.json()) as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) => item.name === SECONDARY_NAME)) {
    const remove = await request.delete(`/api/v1/connections/${connection.id}`);
    expect(remove.ok()).toBeTruthy();
  }

  const create = await request.post('/api/v1/connections', {
    data: {
      name: SECONDARY_NAME,
      type: 'SSH',
      host: SECONDARY_HOST,
      port: 22,
      username: 'search-e2e',
      auth_method: 'password',
      password: 'not-used-in-this-test',
    },
  });
  expect(create.status()).toBe(201);
  const body = (await create.json()) as { connection: { id: number } };
  return body.connection.id;
}

test('workspace connection search filters by name and host and restores the full list', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: { showConnectionTags: 'false' },
  });
  expect(settings.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const primaryId = await ensureTestSshConnection(context.request);
  const secondaryId = await recreateSecondaryConnection(context.request);
  await connectTestSshFromConnectionsPage(page, primaryId);

  await page.getByTitle('Connections', { exact: true }).click();
  const list = page.getByTestId('workspace-connection-list');
  const search = list.locator('input[data-focus-id="connectionListSearch"]');
  const primaryRow = list.locator(`li[data-conn-id="${primaryId}"]`);
  const secondaryRow = list.locator(`li[data-conn-id="${secondaryId}"]`);

  await step('Connection search filters by display name', async () => {
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(search).toBeVisible({ timeout: 20_000 });
    await expect(primaryRow).toBeVisible();
    await expect(secondaryRow).toBeVisible();
    await search.fill('Search Secondary');
    await expect(secondaryRow).toBeVisible();
    await expect(primaryRow).toHaveCount(0);
  });

  await step('Connection search also matches host and reports no-results cleanly', async () => {
    await search.fill('127.0.0.1');
    await expect(primaryRow).toBeVisible();
    await expect(secondaryRow).toHaveCount(0);

    await search.fill('definitely-no-connection-e2e');
    await expect(list.getByText(/No connections found matching/)).toBeVisible();
    await expect(primaryRow).toHaveCount(0);
    await expect(secondaryRow).toHaveCount(0);
  });

  await step('Clearing connection search restores all connections', async () => {
    await search.fill('');
    await expect(primaryRow).toBeVisible();
    await expect(secondaryRow).toBeVisible();
  });
});
