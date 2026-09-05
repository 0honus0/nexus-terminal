import { expect, test, type Locator } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';

async function expectHorizontallyInside(locator: Locator, viewportWidth: number): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
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
      language: 'zh-CN',
      dashboardShowLocalResources: true,
      dashboardShowRemoteResources: true,
    },
  });
  expect(normalizedSettings.ok()).toBeTruthy();

  const connectionId = await ensureTestSshConnection(context.request);

  try {
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
