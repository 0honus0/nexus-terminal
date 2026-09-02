import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const PROXY_NAME = 'E2E Audit Filter Proxy';

test('audit log UI filters by action type and details search term', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);

  const existing = await context.request.get('/api/v1/proxies');
  if (existing.ok()) {
    for (const proxy of (await existing.json() as Array<{ id: number; name: string }>).filter((item) => item.name === PROXY_NAME)) {
      await context.request.delete(`/api/v1/proxies/${proxy.id}`);
    }
  }

  const create = await context.request.post('/api/v1/proxies', {
    data: { name: PROXY_NAME, type: 'HTTP', host: '127.0.0.1', port: 18081 },
  });
  expect(create.status()).toBe(201);
  const proxyId = (await create.json() as { proxy: { id: number } }).proxy.id;

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
