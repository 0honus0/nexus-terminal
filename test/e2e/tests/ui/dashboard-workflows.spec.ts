import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';

const ALPHA_NAME = 'E2E Dashboard Alpha';
const BETA_NAME = 'E2E Dashboard Beta';
const ALPHA_TAG = 'E2E Dashboard Alpha Tag';
const BETA_TAG = 'E2E Dashboard Beta Tag';

async function cleanupDashboardFixtures(request: APIRequestContext): Promise<void> {
  const connectionsResponse = await request.get('/api/v1/connections');
  expect(connectionsResponse.ok()).toBeTruthy();
  const connections = await connectionsResponse.json() as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter(item => item.name === ALPHA_NAME || item.name === BETA_NAME)) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }

  const tagsResponse = await request.get('/api/v1/tags');
  expect(tagsResponse.ok()).toBeTruthy();
  const tags = await tagsResponse.json() as Array<{ id: number; name: string }>;
  for (const tag of tags.filter(item => item.name === ALPHA_TAG || item.name === BETA_TAG)) {
    expect((await request.delete(`/api/v1/tags/${tag.id}`)).ok()).toBeTruthy();
  }
}

async function createTag(request: APIRequestContext, name: string): Promise<number> {
  const response = await request.post('/api/v1/tags', { data: { name } });
  expect(response.status()).toBe(201);
  return (await response.json() as { tag: { id: number } }).tag.id;
}

async function createConnection(
  request: APIRequestContext,
  name: string,
  username: string,
  host: string,
  tagId: number,
): Promise<number> {
  const create = await request.post('/api/v1/connections', {
    data: {
      name,
      type: 'SSH',
      host,
      port: 22,
      username,
      auth_method: 'password',
      password: 'dashboard-e2e-not-used',
      notes: `${name} notes`,
    },
  });
  expect(create.status()).toBe(201);
  const id = (await create.json() as { connection: { id: number } }).connection.id;

  const assignTag = await request.post('/api/v1/connections/add-tag', {
    data: { connection_ids: [id], tag_id: tagId },
  });
  expect(assignTag.ok()).toBeTruthy();
  return id;
}

test('dashboard filters connections and persists tag and sort preferences across reloads', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await cleanupDashboardFixtures(context.request);

  const alphaTagId = await createTag(context.request, ALPHA_TAG);
  const betaTagId = await createTag(context.request, BETA_TAG);
  const alphaId = await createConnection(context.request, ALPHA_NAME, 'dashboard-alpha', '192.0.2.10', alphaTagId);
  const betaId = await createConnection(context.request, BETA_NAME, 'dashboard-beta', '192.0.2.20', betaTagId);

  try {
    await page.goto('/');
    const dashboard = page.getByTestId('dashboard-view');
    await expect(dashboard).toBeVisible();
    const alphaRow = dashboard.getByTestId(`dashboard-connection-row-${alphaId}`);
    const betaRow = dashboard.getByTestId(`dashboard-connection-row-${betaId}`);
    await expect(alphaRow).toContainText(ALPHA_NAME);
    await expect(betaRow).toContainText(BETA_NAME);

    await step('search matches username and host fields', async () => {
      const search = dashboard.getByTestId('dashboard-connection-search');
      await search.fill('dashboard-alpha');
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeHidden();

      await search.fill('192.0.2.20');
      await expect(betaRow).toBeVisible();
      await expect(alphaRow).toBeHidden();
      await search.fill('');
    });

    await step('tag filtering persists across a full page reload', async () => {
      const filter = dashboard.getByTestId('dashboard-tag-filter');
      await filter.selectOption(String(alphaTagId));
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeHidden();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('dashboard_connections_filter_tag'))).toBe(String(alphaTagId));

      await page.reload();
      const reloadedDashboard = page.getByTestId('dashboard-view');
      await expect(reloadedDashboard.getByTestId('dashboard-tag-filter')).toHaveValue(String(alphaTagId));
      await expect(reloadedDashboard.getByTestId(`dashboard-connection-row-${alphaId}`)).toBeVisible();
      await expect(reloadedDashboard.getByTestId(`dashboard-connection-row-${betaId}`)).toBeHidden();
    });

    await step('sort field and order persist independently from the connection data', async () => {
      const reloadedDashboard = page.getByTestId('dashboard-view');
      await reloadedDashboard.getByTestId('dashboard-tag-filter').selectOption({ index: 0 });
      await reloadedDashboard.getByTestId('dashboard-sort-by').selectOption('name');
      await reloadedDashboard.getByTestId('dashboard-sort-order').click();

      await expect.poll(() => page.evaluate(() => ({
        sortBy: localStorage.getItem('dashboard_connections_sort_by'),
        sortOrder: localStorage.getItem('dashboard_connections_sort_order'),
      }))).toEqual({ sortBy: 'name', sortOrder: 'asc' });

      await page.reload();
      const finalDashboard = page.getByTestId('dashboard-view');
      await expect(finalDashboard.getByTestId('dashboard-sort-by')).toHaveValue('name');
      const visibleFixtureRows = finalDashboard.locator('[data-testid^="dashboard-connection-row-"]')
        .filter({ hasText: /E2E Dashboard (Alpha|Beta)/ });
      const texts = await visibleFixtureRows.allTextContents();
      expect(texts.map(text => text.includes(ALPHA_NAME) ? ALPHA_NAME : BETA_NAME)).toEqual([ALPHA_NAME, BETA_NAME]);

      await expect(finalDashboard.getByTestId('dashboard-overview')).toBeVisible();
      await expect(finalDashboard.getByTestId('dashboard-connections-link')).toBeVisible();
      await expect(finalDashboard.getByTestId(`dashboard-connect-${alphaId}`)).toBeVisible();
      await expect(finalDashboard.getByTestId(`dashboard-connect-${betaId}`)).toBeVisible();
      await captureFunctionalScreenshot(page, 'dashboard-home.png', { viewport: { width: 1440, height: 900 } });
    });

    await step('recent activity links to the full audit log view', async () => {
      await page.getByTestId('dashboard-audit-link').click();
      await expect(page).toHaveURL(/\/audit-logs$/);
      await expect(page.getByTestId('audit-log-view')).toBeVisible();
    });
  } finally {
    await cleanupDashboardFixtures(context.request);
  }
});
