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
