import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

test('direct navigation to HTML theme content displays source without same-origin script execution', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  const name = `e2e-source-${randomUUID()}.html`;
  const source =
    '<!doctype html><script>document.documentElement.dataset.e2eExecuted="yes";localStorage.setItem("e2e-theme-executed","yes")</script><h1>E2E untrusted theme</h1>';
  const created = await context.request.post('/api/v1/appearance/html-presets/local', {
    data: { name, content: source },
  });
  expect(created.status(), await created.text()).toBe(201);
  const path = `/api/v1/appearance/html-presets/local/${name}`;
  try {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('e2e-theme-executed'));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const headers = response!.headers();
    expect(headers['content-type']).toContain('text/plain');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain('sandbox');
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    await expect(page.locator('body')).toContainText(source);
    await expect(page.locator('script')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.e2eExecuted)).toBeUndefined();
    await page.goto('/');
    expect(await page.evaluate(() => localStorage.getItem('e2e-theme-executed'))).toBeNull();
  } finally {
    expect((await context.request.delete(path)).ok()).toBeTruthy();
  }
});
