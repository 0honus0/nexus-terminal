import { expect, test, type APIRequestContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';

const MOBILE_NAMES = [
  'E2E Mobile Dashboard Connection Alpha With A Long Name',
  'E2E Mobile Dashboard Connection Beta With A Long Name',
];

async function expectHorizontallyInside(locator: Locator, viewportWidth: number): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
}

async function clearConnections(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = (await response.json()) as Array<{ id: number }>;
  for (const connection of connections) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }
}

async function createMobileConnection(request: APIRequestContext, name: string, username: string): Promise<number> {
  const response = await request.post('/api/v1/connections', {
    data: {
      name,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username,
      authMethod: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { connection: { id: number } }).connection.id;
}

async function switchInterfaceToChinese(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('tab', { name: 'System' })).toBeVisible();
  await page.getByRole('tab', { name: 'System' }).click();
  const language = page.locator('#languageSelect');
  await expect(language).toBeVisible();
  await language.selectOption('zh-CN');
  const save = page.waitForResponse(
    (response) => response.url().includes('/api/v1/settings') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save Language' }).click();
  expect((await save).ok()).toBeTruthy();
  await expect(page.getByRole('tab', { name: '系统' })).toBeVisible();
}

test('mobile dashboard reflows without horizontal overflow or cramped control rows', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);

  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as {
    language?: string;
    dashboardShowLocalResources?: boolean;
    dashboardShowRemoteResources?: boolean;
  };

  const normalizedSettings = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      dashboardShowLocalResources: true,
      dashboardShowRemoteResources: true,
    },
  });
  expect(normalizedSettings.ok()).toBeTruthy();

  const connectionId = await ensureTestSshConnection(context.request);

  try {
    await switchInterfaceToChinese(page);
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 412, height: 915 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');

      const dashboard = page.getByTestId('dashboard-view');
      await expect(dashboard).toBeVisible();
      await expect(dashboard.getByTestId('dashboard-local-resources')).toBeVisible();
      await expect(dashboard.getByTestId('dashboard-system-resources')).toBeVisible();
      await expect(dashboard.getByTestId('dashboard-connection-list')).toBeVisible();
      await expect(dashboard.getByTestId('dashboard-ssh-resource-list')).toBeVisible();

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);

      for (const locator of [
        dashboard,
        dashboard.getByTestId('dashboard-overview'),
        dashboard.getByTestId('dashboard-local-resources'),
        dashboard.getByTestId('dashboard-connection-list'),
        dashboard.getByTestId('dashboard-system-resources'),
        dashboard.getByTestId('dashboard-ssh-resource-list'),
        dashboard.getByTestId('dashboard-recent-activity'),
      ]) {
        await expectHorizontallyInside(locator, viewport.width);
      }

      const statsBox = await dashboard.getByTestId('dashboard-overview-stats').boundingBox();
      const localResourcesBox = await dashboard.getByTestId('dashboard-local-resources').boundingBox();
      expect(statsBox).not.toBeNull();
      expect(localResourcesBox).not.toBeNull();
      expect(localResourcesBox!.y).toBeGreaterThanOrEqual(statsBox!.y + statsBox!.height - 1);

      const toolbar = dashboard.getByTestId('dashboard-connection-search').locator('..');
      const searchBox = await dashboard.getByTestId('dashboard-connection-search').boundingBox();
      const tagBox = await dashboard.getByTestId('dashboard-tag-filter').boundingBox();
      const sortBox = await dashboard.getByTestId('dashboard-sort-by').boundingBox();
      const orderBox = await dashboard.getByTestId('dashboard-sort-order').boundingBox();
      expect(searchBox).not.toBeNull();
      expect(tagBox).not.toBeNull();
      expect(sortBox).not.toBeNull();
      expect(orderBox).not.toBeNull();
      expect(tagBox!.y).toBeGreaterThan(searchBox!.y + searchBox!.height - 1);
      expect(Math.abs(tagBox!.y - sortBox!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(tagBox!.y - orderBox!.y)).toBeLessThanOrEqual(1);
      await expectHorizontallyInside(toolbar, viewport.width);

      const connectionRow = dashboard.getByTestId(`dashboard-connection-row-${connectionId}`);
      const connectButton = dashboard.getByTestId(`dashboard-connect-${connectionId}`);
      await expect(connectionRow).toBeVisible();
      const rowBox = await connectionRow.boundingBox();
      const connectBox = await connectButton.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(connectBox).not.toBeNull();
      expect(connectBox!.width).toBeGreaterThanOrEqual(rowBox!.width - 26);
      expect(connectBox!.y).toBeGreaterThan(rowBox!.y + 20);
      await expectHorizontallyInside(connectionRow, viewport.width);
    }
  } finally {
    const restoreSettings = await context.request.put('/api/v1/settings', {
      data: {
        language: originalSettings.language ?? 'en-US',
        dashboardShowLocalResources: originalSettings.dashboardShowLocalResources ?? true,
        dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? true,
      },
    });
    expect(restoreSettings.ok()).toBeTruthy();
  }
});

test('mobile dashboard keeps empty and multi-connection states usable when resource panels are disabled', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as {
    dashboardShowLocalResources?: boolean;
    dashboardShowRemoteResources?: boolean;
  };

  const disableResources = await context.request.put('/api/v1/settings', {
    data: { dashboardShowLocalResources: false, dashboardShowRemoteResources: false },
  });
  expect(disableResources.ok()).toBeTruthy();
  await clearConnections(context.request);

  try {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 412, height: 915 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const dashboard = page.getByTestId('dashboard-view');
      await expect(dashboard).toBeVisible();
      await expect(dashboard.getByTestId('dashboard-system-resources')).toHaveCount(0);
      await expect(dashboard.getByTestId('dashboard-local-resources')).toHaveCount(0);
      await expect(dashboard.getByText(/No connection records|没有连接记录|接続記録がありません/)).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);
      await expectHorizontallyInside(dashboard.getByTestId('dashboard-connection-list'), viewport.width);
      await expectHorizontallyInside(dashboard.getByTestId('dashboard-recent-activity'), viewport.width);
    }

    const ids = [
      await createMobileConnection(context.request, MOBILE_NAMES[0], 'mobile-dashboard-alpha-user'),
      await createMobileConnection(context.request, MOBILE_NAMES[1], 'mobile-dashboard-beta-user'),
    ];

    for (const viewport of [
      { width: 360, height: 800 },
      { width: 412, height: 915 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const dashboard = page.getByTestId('dashboard-view');
      await expect(dashboard.getByTestId('dashboard-system-resources')).toHaveCount(0);
      await expect(dashboard.getByTestId('dashboard-local-resources')).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);

      const search = dashboard.getByTestId('dashboard-connection-search');
      const tag = dashboard.getByTestId('dashboard-tag-filter');
      const sort = dashboard.getByTestId('dashboard-sort-by');
      const order = dashboard.getByTestId('dashboard-sort-order');
      for (const control of [search, tag, sort, order]) {
        await expect(control).toBeVisible();
        await expectHorizontallyInside(control, viewport.width);
      }

      for (const id of ids) {
        const row = dashboard.getByTestId(`dashboard-connection-row-${id}`);
        const connect = dashboard.getByTestId(`dashboard-connect-${id}`);
        await expect(row).toBeVisible();
        await expect(connect).toBeVisible();
        await expectHorizontallyInside(row, viewport.width);
        await expectHorizontallyInside(connect, viewport.width);
      }

      await search.fill('mobile-dashboard-beta-user');
      await expect(dashboard.getByTestId(`dashboard-connection-row-${ids[0]}`)).toHaveCount(0);
      await expect(dashboard.getByTestId(`dashboard-connection-row-${ids[1]}`)).toBeVisible();
      await search.fill('');

      await Promise.all([
        page.waitForURL(
          (url) => url.pathname.includes('/workspace') && url.searchParams.get('connectionId') === String(ids[0]),
        ),
        dashboard.getByTestId(`dashboard-connect-${ids[0]}`).click(),
      ]);
      await page.goto('/');
    }
  } finally {
    const restoreSettings = await context.request.put('/api/v1/settings', {
      data: {
        dashboardShowLocalResources: originalSettings.dashboardShowLocalResources ?? true,
        dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? true,
      },
    });
    expect(restoreSettings.ok()).toBeTruthy();
  }
});
