import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';

const ALPHA_NAME = 'E2E Dashboard Alpha';
const BETA_NAME = 'E2E Dashboard Beta';
const ALPHA_TAG = 'E2E Dashboard Alpha Tag';
const BETA_TAG = 'E2E Dashboard Beta Tag';
const DASHBOARD_DARK_THEME = {
  '--app-bg-color': '#212529',
  '--text-color': '#e9ecef',
  '--text-color-secondary': '#adb5bd',
  '--border-color': '#495057',
  '--link-color': '#BB86FC',
  '--link-hover-color': '#D1A9FF',
  '--link-active-color': '#A06CD5',
  '--link-active-bg-color': 'rgba(160, 108, 213, 0.2)',
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)',
  '--header-bg-color': '#343a40',
  '--footer-bg-color': '#343a40',
  '--button-bg-color': 'var(--link-active-color)',
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#8E44AD',
  '--icon-color': 'var(--text-color-secondary)',
  '--icon-hover-color': 'var(--link-hover-color)',
  '--split-line-color': 'var(--border-color)',
  '--split-line-hover-color': 'var(--border-color)',
  '--input-focus-border-color': 'var(--link-active-color)',
  '--input-focus-glow': 'var(--link-active-color)',
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.8)',
  '--color-success': '#5cb85c',
  '--color-error': '#d9534f',
  '--color-warning': '#f0ad4e',
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};

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

  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = await originalSettingsResponse.json() as Record<string, string | undefined>;
  const originalAppearanceResponse = await context.request.get('/api/v1/appearance');
  expect(originalAppearanceResponse.ok()).toBeTruthy();
  const originalAppearance = await originalAppearanceResponse.json() as { customUiTheme?: string; windowThemeColor?: string };

  const normalizeSettings = await context.request.put('/api/v1/settings', {
    data: {
      language: 'zh-CN',
      dashboardShowLocalResources: 'true',
      dashboardShowRemoteResources: 'true',
    },
  });
  expect(normalizeSettings.ok()).toBeTruthy();
  const darkAppearance = await context.request.put('/api/v1/appearance', {
    data: {
      customUiTheme: JSON.stringify(DASHBOARD_DARK_THEME),
      windowThemeColor: '#343a40',
    },
  });
  expect(darkAppearance.ok()).toBeTruthy();

  const systemStatusResponse = await context.request.get('/api/v1/system/status');
  expect(systemStatusResponse.ok()).toBeTruthy();
  const systemStatus = await systemStatusResponse.json() as {
    cpuPercent: number;
    memPercent: number;
    memUsed: number;
    memTotal: number;
    diskPercent?: number;
  };
  expect(systemStatus.cpuPercent).toBeGreaterThanOrEqual(0);
  expect(systemStatus.cpuPercent).toBeLessThanOrEqual(100);
  expect(systemStatus.memPercent).toBeGreaterThanOrEqual(0);
  expect(systemStatus.memPercent).toBeLessThanOrEqual(100);
  expect(systemStatus.memUsed).toBeGreaterThanOrEqual(0);
  expect(systemStatus.memTotal).toBeGreaterThan(0);
  if (systemStatus.diskPercent !== undefined) {
    expect(systemStatus.diskPercent).toBeGreaterThanOrEqual(0);
    expect(systemStatus.diskPercent).toBeLessThanOrEqual(100);
  }

  const alphaTagId = await createTag(context.request, ALPHA_TAG);
  const betaTagId = await createTag(context.request, BETA_TAG);
  const alphaId = await createConnection(context.request, ALPHA_NAME, 'dashboard-alpha', '192.0.2.10', alphaTagId);
  const betaId = await createConnection(context.request, BETA_NAME, 'dashboard-beta', '192.0.2.20', betaTagId);

  try {
    await page.goto('/');
    const dashboard = page.getByTestId('dashboard-view');
    await expect(dashboard).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-system-resources')).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-local-resources')).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-remote-resources')).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-local-resources')).toContainText('CPU');
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

    await step('local and remote dashboard resource sections honor their independent settings', async () => {
      const remoteOnly = await context.request.put('/api/v1/settings', {
        data: {
          dashboardShowLocalResources: 'false',
          dashboardShowRemoteResources: 'true',
        },
      });
      expect(remoteOnly.ok()).toBeTruthy();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('dashboard-system-resources')).toBeVisible();
      await expect(page.getByTestId('dashboard-local-resources')).toBeHidden();
      await expect(page.getByTestId('dashboard-remote-resources')).toBeVisible();

      const localOnly = await context.request.put('/api/v1/settings', {
        data: {
          dashboardShowLocalResources: 'true',
          dashboardShowRemoteResources: 'false',
        },
      });
      expect(localOnly.ok()).toBeTruthy();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('dashboard-local-resources')).toBeVisible();
      await expect(page.getByTestId('dashboard-remote-resources')).toBeHidden();

      const restoreBoth = await context.request.put('/api/v1/settings', {
        data: {
          dashboardShowLocalResources: 'true',
          dashboardShowRemoteResources: 'true',
        },
      });
      expect(restoreBoth.ok()).toBeTruthy();
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await step('recent activity links to the full audit log view', async () => {
      await page.getByTestId('dashboard-audit-link').click();
      await expect(page).toHaveURL(/\/audit-logs$/);
      await expect(page.getByTestId('audit-log-view')).toBeVisible();
    });
  } finally {
    await cleanupDashboardFixtures(context.request);
    const restoreSettings = await context.request.put('/api/v1/settings', {
      data: {
        language: originalSettings.language ?? 'en-US',
        dashboardShowLocalResources: originalSettings.dashboardShowLocalResources ?? 'true',
        dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? 'true',
      },
    });
    expect(restoreSettings.ok()).toBeTruthy();
    const restoreAppearance = await context.request.put('/api/v1/appearance', {
      data: {
        customUiTheme: originalAppearance.customUiTheme,
        windowThemeColor: originalAppearance.windowThemeColor,
      },
    });
    expect(restoreAppearance.ok()).toBeTruthy();
  }
});
