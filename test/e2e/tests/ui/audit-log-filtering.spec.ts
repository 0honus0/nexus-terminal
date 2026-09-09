import { writeFile } from 'node:fs/promises';
import type { TestInfo } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const PROXY_NAME = 'E2E Audit Filter Proxy';
const PAGINATION_PREFIX = 'E2E Audit Pagination Proxy';
const PAGINATION_COUNT = 51;

async function cleanupPaginationProxies(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/proxies');
  expect(response.ok()).toBeTruthy();
  const proxies = (await response.json()) as Array<{ id: number; name: string }>;
  for (const proxy of proxies.filter((item) => item.name.startsWith(PAGINATION_PREFIX))) {
    const remove = await request.delete(`/api/v1/proxies/${proxy.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

async function capturePaginationEvidence(
  page: import('@playwright/test').Page,
  testInfo: TestInfo,
  name: 'before' | 'after',
): Promise<void> {
  const metrics = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('[data-testid="audit-log-view"]');
    const title = view?.querySelector<HTMLElement>('h1');
    const filter = view?.querySelector<HTMLElement>('[data-testid="audit-apply-filter"]');
    const table = view?.querySelector<HTMLElement>('table');
    const tableScroller = view?.querySelector<HTMLElement>('[class*="overflow-x-auto"]');
    return {
      language: document.documentElement.lang,
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewPadding: view ? getComputedStyle(view).padding : '',
      titleFontSize: title ? getComputedStyle(title).fontSize : '',
      filterHeight: filter?.getBoundingClientRect().height ?? 0,
      tableWidth: table?.getBoundingClientRect().width ?? 0,
      tableScrollerWidth: tableScroller?.getBoundingClientRect().width ?? 0,
      tableScrollWidth: tableScroller?.scrollWidth ?? 0,
    };
  });
  const screenshotPath = testInfo.outputPath(`audit-pagination-${name}.png`);
  const metricsPath = testInfo.outputPath(`audit-pagination-${name}.metrics.json`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await testInfo.attach(`M07.02/03 audit ${name} screenshot`, { path: screenshotPath, contentType: 'image/png' });
  await testInfo.attach(`M07.02/03 audit ${name} metrics`, { path: metricsPath, contentType: 'application/json' });
  console.log(
    `[M07.02/03 audit ${name} metrics] language=${metrics.language} viewport=${metrics.viewport.width}x${metrics.viewport.height} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} viewPadding=${metrics.viewPadding} titleFontSize=${metrics.titleFontSize} filterHeight=${metrics.filterHeight} table=${metrics.tableWidth}/${metrics.tableScrollerWidth}/${metrics.tableScrollWidth}`,
  );
  expect(metrics.language).toMatch(/^en(?:-US)?$/);
  expect(metrics.viewport).toEqual({ width: 1280, height: 800 });
  expect(metrics.viewPadding).toBe('16px');
  expect(metrics.titleFontSize).toBe('20px');
  expect(metrics.filterHeight).toBeGreaterThan(0);
  expect(metrics.tableWidth).toBeGreaterThan(0);
  expect(metrics.tableScrollerWidth).toBeGreaterThan(0);
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
}

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

test('audit log pagination resets on filters and retains active filters across pages', async ({
  page,
  context,
}, testInfo) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', {
    data: { language: 'en-US', timezone: 'UTC' },
  });
  expect(language.ok()).toBeTruthy();
  await cleanupPaginationProxies(context.request);

  const proxyIds: number[] = [];
  try {
    await step(`create ${PAGINATION_COUNT} real proxy records for paginated audit entries`, async () => {
      for (let index = 1; index <= PAGINATION_COUNT; index += 1) {
        const create = await context.request.post('/api/v1/proxies', {
          data: {
            name: `${PAGINATION_PREFIX} ${String(index).padStart(2, '0')}`,
            type: 'HTTP',
            host: '127.0.0.1',
            port: 18090 + index,
          },
        });
        expect(create.status()).toBe(201);
        proxyIds.push(((await create.json()) as { proxy: { id: number } }).proxy.id);
      }

      const auditResponse = await context.request.get('/api/v1/audit-logs', {
        params: { limit: 100, offset: 0, actionType: 'PROXY_CREATED', search: PAGINATION_PREFIX },
      });
      expect(auditResponse.ok()).toBeTruthy();
      await expect(auditResponse.json()).resolves.toMatchObject({
        total: PAGINATION_COUNT,
        limit: 100,
        offset: 0,
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/audit-logs');
    const view = page.getByTestId('audit-log-view');
    await expect(view).toBeVisible();
    await expect(view.getByRole('heading', { name: 'Audit Logs', exact: true })).toBeVisible();
    await expect(view.locator('tr[data-audit-id]')).toHaveCount(50, { timeout: 15_000 });
    await capturePaginationEvidence(page, testInfo, 'before');

    const waitForAuditRequest = (offset: number, search: string) =>
      page.waitForResponse((response) => {
        if (!response.url().includes('/api/v1/audit-logs') || response.request().method() !== 'GET') return false;
        const query = new URL(response.url()).searchParams;
        return (
          query.get('actionType') === 'PROXY_CREATED' &&
          query.get('search') === search &&
          query.get('offset') === String(offset)
        );
      });
    const paginationInfo = (value: string) => view.getByText(value, { exact: true });

    await step('apply action and details filters on page one', async () => {
      await view.getByTestId('audit-action-type').selectOption('PROXY_CREATED');
      await view.getByTestId('audit-search').fill(PAGINATION_PREFIX);
      const responsePromise = waitForAuditRequest(0, PAGINATION_PREFIX);
      await view.getByTestId('audit-apply-filter').click();
      expect((await responsePromise).ok()).toBeTruthy();
      await expect(paginationInfo(`Page 1 of 2 (${PAGINATION_COUNT} total logs)`)).toBeVisible();
      await expect(view.locator('tr[data-audit-id]')).toHaveCount(50);
      await expect(view.getByTestId('audit-search')).toHaveValue(PAGINATION_PREFIX);
      await expect(view.getByTestId('audit-action-type')).toHaveValue('PROXY_CREATED');
    });

    await step('move to page two while retaining both active filters', async () => {
      const navigation = view.getByRole('navigation', { name: 'Audit Logs', exact: true });
      const responsePromise = waitForAuditRequest(50, PAGINATION_PREFIX);
      await navigation.getByRole('button', { name: '2', exact: true }).click();
      expect((await responsePromise).ok()).toBeTruthy();
      await expect(paginationInfo(`Page 2 of 2 (${PAGINATION_COUNT} total logs)`)).toBeVisible();
      await expect(view.locator('tr[data-audit-id]')).toHaveCount(1);
      await expect(view.getByTestId('audit-search')).toHaveValue(PAGINATION_PREFIX);
      await expect(view.getByTestId('audit-action-type')).toHaveValue('PROXY_CREATED');
      await expect(view.locator('tr[data-audit-id]').first()).toContainText(PAGINATION_PREFIX);
    });

    await step('changing the search term returns to page one with the retained action filter', async () => {
      const uniqueName = `${PAGINATION_PREFIX} 01`;
      await view.getByTestId('audit-search').fill(uniqueName);
      const responsePromise = waitForAuditRequest(0, uniqueName);
      await view.getByTestId('audit-apply-filter').click();
      expect((await responsePromise).ok()).toBeTruthy();
      await expect(paginationInfo('Page 1 of 1 (1 total logs)')).toBeVisible();
      await expect(view.locator('tr[data-audit-id]')).toHaveCount(1);
      await expect(view.locator('tr[data-audit-id]').first()).toContainText(uniqueName);
      await expect(view.getByTestId('audit-action-type')).toHaveValue('PROXY_CREATED');
    });

    await capturePaginationEvidence(page, testInfo, 'after');
  } finally {
    for (const id of proxyIds) {
      const remove = await context.request.delete(`/api/v1/proxies/${id}`);
      expect(remove.ok()).toBeTruthy();
    }
    await cleanupPaginationProxies(context.request);
  }
});
