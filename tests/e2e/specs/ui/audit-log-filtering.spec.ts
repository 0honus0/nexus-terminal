import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { selectUiOption } from '../../support/ui-select';

test('audit activity shares the toolbar, loads on scroll, and bounds rendered rows', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const requests: Array<{ offset: number; search: string; action: string }> = [];
  await page.route('**/api/v1/audit-logs?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const offset = Number(query.get('offset') || 0);
    const limit = Number(query.get('limit') || 40);
    const search = query.get('search') || '';
    const action = query.get('actionType') || '';
    requests.push({ offset, search, action });
    const total = search ? 1 : 500;
    const logs = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({
      id: 500 - offset - index,
      timestamp: 1700000000 - offset - index,
      actionType: 'PROXY_CREATED',
      details: { name: search || `Audit proxy ${offset + index}`, proxyId: offset + index },
    }));
    await route.fulfill({ json: { logs, total, limit, offset } });
  });
  await page.goto('/audit-logs');
  const view = page.locator('.audit-page');
  await expect(view.getByText('40 / 500 records loaded')).toBeVisible();
  const scroller = view.locator('.audit-scroller');
  for (let batch = 2; batch <= 5; batch++) {
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(view.getByText(`${batch * 40} / 500 records loaded`)).toBeVisible();
  }
  expect(await view.locator('[data-audit-id]').count()).toBeLessThan(25);
  expect(requests.filter((request) => request.offset === 40)).toHaveLength(1);
  const actionSelect = view.getByRole('combobox', { name: 'Action Type', exact: true });
  await actionSelect.click();
  const actionPanel = page.locator('[data-ui="select-panel"]');
  await expect(actionPanel).toBeVisible();
  await expect(async () => {
    const triggerBox = await actionSelect.boundingBox();
    const panelBox = await actionPanel.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(Math.abs(panelBox!.width - triggerBox!.width)).toBeLessThan(2);
    expect(Math.abs(panelBox!.x - triggerBox!.x)).toBeLessThan(2);
    expect(Math.abs(panelBox!.y - triggerBox!.y - triggerBox!.height)).toBeLessThan(2);
  }).toPass();
  await page.keyboard.press('Escape');
  await selectUiOption(view.getByRole('combobox', { name: 'Action Type', exact: true }), 'PROXY_CREATED');
  await view.getByRole('searchbox', { name: 'Search', exact: true }).fill('Unique audit target');
  await expect(view.getByText('1 / 1 records loaded')).toBeVisible();
  await expect(view.locator('[data-audit-id]')).toContainText('Unique audit target');
  expect(requests.at(-1)).toEqual({ offset: 0, search: 'Unique audit target', action: 'PROXY_CREATED' });
  const row = view.locator('[data-audit-id]');
  const requestCount = requests.length;
  await expect(row.locator('dl')).toHaveCount(0);
  await expect(row.locator('pre')).toContainText('Unique audit target');
  expect(requests.length).toBe(requestCount);
  await page.setViewportSize({ width: 320, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('audit load-more failure preserves records and can be retried', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  let fail = true;
  await page.route('**/api/v1/audit-logs?*', async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
    if (offset && fail) {
      await route.fulfill({ status: 500, json: {} });
      return;
    }
    await route.fulfill({
      json: {
        logs: Array.from({ length: offset ? 1 : 40 }, (_, index) => ({
          id: offset + index + 1,
          timestamp: 1700000000,
          actionType: 'LOGIN_SUCCESS',
          details: { username: 'Audit user' },
        })),
        total: 41,
        limit: 40,
        offset,
      },
    });
  });
  await page.goto('/audit-logs');
  await expect(page.getByText('40 / 41 records loaded')).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('40 / 41 records loaded')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('41 / 41 records loaded')).toBeVisible();
  await expect(page.getByText('All records loaded')).toBeVisible();
});
