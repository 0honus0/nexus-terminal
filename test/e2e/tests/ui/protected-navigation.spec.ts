import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

test('an authenticated browser can open a protected settings page', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('#username')).toHaveCount(0);

  const authStatus = await context.request.get('/api/v1/auth/status');
  expect(authStatus.ok()).toBeTruthy();
});

test('auth status probe failures fall back to Login instead of rejecting protected navigation', async ({ page }) => {
  await page.route('**/api/v1/auth/needs-setup', async (route) => route.abort('failed'));
  await page.route('**/api/v1/auth/status', async (route) => route.abort('failed'));

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('#username')).toBeVisible();
  await expect(page).not.toHaveURL(/\/setup$/);
});
