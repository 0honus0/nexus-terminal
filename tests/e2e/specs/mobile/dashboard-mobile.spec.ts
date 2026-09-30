import { expect, test, type APIRequestContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import { selectUiOption } from '../../support/ui-select';

const MOBILE_NAMES = [
  'E2E Mobile Dashboard Connection Alpha With A Long Name',
  'E2E Mobile Dashboard Connection Beta With A Long Name',
];

const dashboardPanel = (page: Page, name: RegExp): Locator =>
  page
    .locator('.dashboard-page section')
    .filter({ has: page.getByRole('heading', { name }) })
    .last();
const connectionPanel = (page: Page): Locator => dashboardPanel(page, /^(Quick connect|快速连接)$/);
const remotePanel = (page: Page): Locator => dashboardPanel(page, /^(SSH resources|SSH Resources|SSH 资源)$/);
const activityPanel = (page: Page): Locator => page.locator('.dashboard-page aside');
const tagFilter = (page: Page): Locator => page.getByRole('combobox', { name: /^(Filter by tag|按标签筛选)$/ });
const sortFilter = (page: Page): Locator => page.getByRole('combobox', { name: /^(Sort by|排序方式)$/ });
const sortOrder = (page: Page): Locator =>
  connectionPanel(page).getByRole('button', { name: /Ascending|Descending|升序|降序/ });
const connectionRow = (page: Page, name: string): Locator =>
  connectionPanel(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) });
const connectButton = (row: Locator): Locator => row.getByRole('button', { name: /^(Connect|连接)$/ });

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
  await selectUiOption(language, 'zh-CN');
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

  await ensureTestSshConnection(context.request);

  try {
    await switchInterfaceToChinese(page);
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 412, height: 915 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');

      const dashboard = page.locator('.dashboard-page');
      await expect(dashboard).toBeVisible();
      const navScroller = page.locator('header .app-nav-links').first();
      await expect(navScroller).toBeVisible();
      const navMetrics = await navScroller.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scrollbarWidth: getComputedStyle(element).scrollbarWidth,
        webkitScrollbarDisplay: getComputedStyle(element, '::-webkit-scrollbar').display,
      }));
      expect(navMetrics.scrollbarWidth).toBe('none');
      expect(navMetrics.webkitScrollbarDisplay).toBe('none');
      if (navMetrics.scrollWidth > navMetrics.clientWidth + 1) {
        await navScroller.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        await expect.poll(() => navScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await navScroller.evaluate((element) => {
          element.scrollLeft = 0;
        });
      } else {
        expect(navMetrics.scrollWidth).toBeLessThanOrEqual(navMetrics.clientWidth + 1);
        await expect.poll(() => navScroller.evaluate((element) => element.scrollLeft)).toBe(0);
      }
      await expect(dashboard.locator('.dashboard-overview-local')).toBeVisible();
      await expect(remotePanel(page)).toBeVisible();
      await expect(connectionPanel(page)).toBeVisible();
      await expect(remotePanel(page).locator('.ui-scroll-area')).toBeVisible();

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);

      for (const locator of [
        dashboard,
        dashboard.locator('section').first(),
        dashboard.locator('.dashboard-overview-local'),
        connectionPanel(page),
        remotePanel(page),
        remotePanel(page).locator('.ui-scroll-area'),
        activityPanel(page),
      ]) {
        await expectHorizontallyInside(locator, viewport.width);
      }

      const statsBox = await dashboard.locator('.dashboard-overview-counts').boundingBox();
      const localResourcesBox = await dashboard.locator('.dashboard-overview-local').boundingBox();
      expect(statsBox).not.toBeNull();
      expect(localResourcesBox).not.toBeNull();
      expect(localResourcesBox!.y).toBeGreaterThanOrEqual(statsBox!.y + statsBox!.height - 1);

      const toolbar = dashboard.locator('.dashboard-toolbar');
      const searchBox = await connectionPanel(page).getByRole('searchbox').boundingBox();
      const tagBox = await tagFilter(page).boundingBox();
      const sortBox = await sortFilter(page).boundingBox();
      const orderBox = await sortOrder(page).boundingBox();
      const toolbarBox = await toolbar.boundingBox();
      expect(searchBox).not.toBeNull();
      expect(tagBox).not.toBeNull();
      expect(sortBox).not.toBeNull();
      expect(orderBox).not.toBeNull();
      expect(toolbarBox).not.toBeNull();
      expect(tagBox!.y).toBeGreaterThan(searchBox!.y + searchBox!.height - 1);
      expect(Math.abs(tagBox!.y - sortBox!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(tagBox!.y - orderBox!.y)).toBeLessThanOrEqual(1);
      for (const control of [tagFilter(page), sortFilter(page)]) {
        const geometry = await control.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const label = element.querySelector(':scope > span')?.getBoundingClientRect();
          const chevron = element.querySelector('svg')?.getBoundingClientRect();
          return {
            height: box.height,
            centerY: box.top + box.height / 2,
            labelCenterY: label ? label.top + label.height / 2 : Number.NaN,
            chevronCenterY: chevron ? chevron.top + chevron.height / 2 : Number.NaN,
          };
        });
        expect(Math.abs(geometry.height - 40)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.labelCenterY - geometry.centerY)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.chevronCenterY - geometry.centerY)).toBeLessThanOrEqual(1);
      }
      await tagFilter(page).click();
      const tagMenu = page.getByRole('listbox');
      await expect(tagMenu).toBeVisible();
      const firstOption = tagMenu.getByRole('option').first();
      const optionGeometry = await firstOption.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const label = element.querySelector('span')?.getBoundingClientRect();
        return label
          ? {
              leftInset: label.left - box.left,
              rightInset: box.right - label.right,
              verticalOffset: Math.abs(label.top + label.height / 2 - (box.top + box.height / 2)),
            }
          : {
              leftInset: Number.NEGATIVE_INFINITY,
              rightInset: Number.NEGATIVE_INFINITY,
              verticalOffset: Number.POSITIVE_INFINITY,
            };
      });
      expect(optionGeometry.leftInset).toBeGreaterThanOrEqual(0);
      expect(optionGeometry.rightInset).toBeGreaterThanOrEqual(0);
      expect(optionGeometry.verticalOffset).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(tagMenu).toBeHidden();
      const filterLeftGap = tagBox!.x - toolbarBox!.x;
      const filterRightGap = toolbarBox!.x + toolbarBox!.width - (orderBox!.x + orderBox!.width);
      expect(Math.abs(filterLeftGap - filterRightGap)).toBeLessThanOrEqual(1);
      await expectHorizontallyInside(toolbar, viewport.width);

      const row = connectionRow(page, 'E2E SSH');
      const connect = connectButton(row);
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      const connectBox = await connect.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(connectBox).not.toBeNull();
      const rowPadding = await row.evaluate((element) => {
        const style = getComputedStyle(element);
        return Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      });
      expect(connectBox!.width).toBeGreaterThanOrEqual(rowBox!.width - rowPadding - 2);
      expect(connectBox!.y).toBeGreaterThan(rowBox!.y + 20);
      await expectHorizontallyInside(row, viewport.width);
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
      const dashboard = page.locator('.dashboard-page');
      await expect(dashboard).toBeVisible();
      await expect(remotePanel(page)).toHaveCount(0);
      await expect(dashboard.locator('.dashboard-overview-local')).toHaveCount(0);
      await expect(dashboard.getByText(/No connection records|没有连接记录|接続記録がありません/)).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);
      await expectHorizontallyInside(connectionPanel(page), viewport.width);
      await expectHorizontallyInside(activityPanel(page), viewport.width);
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
      const dashboard = page.locator('.dashboard-page');
      await expect(remotePanel(page)).toHaveCount(0);
      await expect(dashboard.locator('.dashboard-overview-local')).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);

      const search = connectionPanel(page).getByRole('searchbox');
      const tag = tagFilter(page);
      const sort = sortFilter(page);
      const order = sortOrder(page);
      for (const control of [search, tag, sort, order]) {
        await expect(control).toBeVisible();
        await expectHorizontallyInside(control, viewport.width);
      }

      for (const name of MOBILE_NAMES) {
        const row = connectionRow(page, name);
        const connect = connectButton(row);
        await expect(row).toBeVisible();
        await expect(connect).toBeVisible();
        await expectHorizontallyInside(row, viewport.width);
        await expectHorizontallyInside(connect, viewport.width);
      }

      await search.fill('mobile-dashboard-beta-user');
      await expect(connectionRow(page, MOBILE_NAMES[0])).toHaveCount(0);
      await expect(connectionRow(page, MOBILE_NAMES[1])).toBeVisible();
      await search.fill('');

      await Promise.all([
        page.waitForURL(
          (url) => url.pathname.includes('/workspace') && url.searchParams.get('connectionId') === String(ids[0]),
        ),
        connectButton(connectionRow(page, MOBILE_NAMES[0])).click(),
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
