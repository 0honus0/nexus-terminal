import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const PROXY_NAME = 'E2E Audit Filter Proxy';

test('audit log UI filters by action type and details search term', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);

  const existing = await context.request.get('/api/v1/proxies');
  if (existing.ok()) {
    for (const proxy of ((await existing.json()) as Array<{ id: number; name: string }>).filter(
      (item) => item.name === PROXY_NAME,
    )) {
      await context.request.delete(`/api/v1/proxies/${proxy.id}`);
    }
  }

  const create = await context.request.post('/api/v1/proxies', {
    data: { name: PROXY_NAME, type: 'HTTP', host: '127.0.0.1', port: 18081 },
  });
  expect(create.status()).toBe(201);
  const proxyId = ((await create.json()) as { proxy: { id: number } }).proxy.id;

  try {
    await page.goto('/audit-logs');
    const view = page.getByTestId('audit-log-view');
    await expect(view).toBeVisible();

    await step('filter to proxy creation events and the unique audit details', async () => {
      await view.getByTestId('audit-action-type').selectOption('PROXY_CREATED');
      await view.getByTestId('audit-search').fill(PROXY_NAME);
      await view.getByTestId('audit-apply-filter').click();
      const row = view.locator('tr[data-audit-id]').filter({ hasText: PROXY_NAME });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await expect(row).toContainText(PROXY_NAME);
    });

    await step('changing the search term to an unrelated value returns no matching rows', async () => {
      await view.getByTestId('audit-search').fill('E2E-AUDIT-NOT-PRESENT');
      await view.getByTestId('audit-apply-filter').click();
      await expect(view.locator('tr[data-audit-id]')).toHaveCount(0, { timeout: 15_000 });
    });
  } finally {
    await context.request.delete(`/api/v1/proxies/${proxyId}`);
  }
});

test('audit log keeps long details scrollable on a narrow screen', async ({ page, context }, testInfo) => {
  await loginAsInitialAdmin(context.request);
  const longName = `E2E Narrow Audit Proxy ${'LongDetails '.repeat(35)}`;
  const create = await context.request.post('/api/v1/proxies', {
    data: { name: longName, type: 'HTTP', host: '127.0.0.1', port: 18082 },
  });
  expect(create.status()).toBe(201);
  const proxyId = ((await create.json()) as { proxy: { id: number } }).proxy.id;

  try {
    await page.setViewportSize({ width: 320, height: 667 });
    await page.goto('/audit-logs');
    const view = page.getByTestId('audit-log-view');
    await expect(view).toBeVisible();
    await view.getByTestId('audit-search').fill(longName);
    await view.getByTestId('audit-apply-filter').click();
    const row = view.locator('tr[data-audit-id]').filter({ hasText: longName });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    const details = row.locator('pre');
    await expect(details).toBeVisible();
    const metrics = await page.evaluate(() => {
      const documentElement = document.documentElement;
      const pre = document.querySelector('tr[data-audit-id] pre');
      const tableScroller = document.querySelector('[class*="overflow-x-auto"]');
      return {
        viewportWidth: documentElement.clientWidth,
        pageScrollWidth: documentElement.scrollWidth,
        detailsClientHeight: pre?.clientHeight ?? 0,
        detailsScrollHeight: pre?.scrollHeight ?? 0,
        tableClientWidth: tableScroller?.clientWidth ?? 0,
        tableScrollWidth: tableScroller?.scrollWidth ?? 0,
      };
    });
    console.log(
      `[M07.02-a audit metrics] viewport=${metrics.viewportWidth} pageScrollWidth=${metrics.pageScrollWidth} details=${metrics.detailsClientHeight}/${metrics.detailsScrollHeight} table=${metrics.tableClientWidth}/${metrics.tableScrollWidth}`,
    );
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.detailsScrollHeight).toBeGreaterThan(metrics.detailsClientHeight);
    await details.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await view.locator('div.overflow-x-auto').evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await page.screenshot({ path: testInfo.outputPath('audit-narrow-long-details.png'), fullPage: true });
  } finally {
    await context.request.delete(`/api/v1/proxies/${proxyId}`);
  }
});
