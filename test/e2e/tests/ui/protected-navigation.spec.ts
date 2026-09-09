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

test('stale dynamically imported components trigger one automatic page recovery', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  let topLevelNavigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) topLevelNavigations += 1;
  });

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  const initialNavigations = topLevelNavigations;

  const reload = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true });
    Object.defineProperty(event, 'payload', {
      value: new Error('Failed to fetch dynamically imported module: /assets/MarkdownPreview-stale.js'),
    });
    window.dispatchEvent(event);
  });
  await reload;
  await expect(page).toHaveURL(/\/settings$/);
  expect(topLevelNavigations).toBe(initialNavigations + 1);

  await page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true });
    Object.defineProperty(event, 'payload', {
      value: new Error('Failed to fetch dynamically imported module: /assets/MarkdownPreview-stale.js'),
    });
    window.dispatchEvent(event);
  });
  await page.waitForTimeout(500);
  expect(topLevelNavigations).toBe(initialNavigations + 1);
});
