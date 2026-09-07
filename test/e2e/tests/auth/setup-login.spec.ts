import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN } from '../../support/auth';

test.describe('initial setup', () => {
  test.use({ e2eDatabaseMode: 'empty' });
  test('creates the initial administrator and redirects to login', async ({ page, request }) => {
    const initialSetupState = await request.get('/api/v1/auth/needs-setup');
    expect(initialSetupState.ok()).toBeTruthy();
    await expect(initialSetupState.json()).resolves.toEqual({ needsSetup: true });

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);

    await page.locator('#username').fill(E2E_ADMIN.username);
    await page.locator('#password').fill(E2E_ADMIN.password);
    await page.locator('#confirmPassword').fill(E2E_ADMIN.password);

    const setupResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/auth/setup') && response.request().method() === 'POST',
    );
    await page.locator('form button[type="submit"]').click();

    const setupResponse = await setupResponsePromise;
    expect(setupResponse.status()).toBe(201);
    await expect(page).toHaveURL(/\/login$/);

    const setupStateAfterRegistration = await request.get('/api/v1/auth/needs-setup');
    expect(setupStateAfterRegistration.ok()).toBeTruthy();
    await expect(setupStateAfterRegistration.json()).resolves.toEqual({ needsSetup: false });
  });
  test('mobile setup retries in place and remains reachable at 320/375 viewports', async ({
    page,
    request,
  }, testInfo) => {
    const collectMetrics = async (label: string) => {
      const metrics = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          page: {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            clientHeight: document.documentElement.clientHeight,
            scrollHeight: document.documentElement.scrollHeight,
            scrollY: window.scrollY,
          },
          elements: {
            form: rect('form'),
            username: rect('#username'),
            password: rect('#password'),
            confirmPassword: rect('#confirmPassword'),
            alert: rect('[role="alert"]'),
            submit: rect('form button[type="submit"]'),
          },
        };
      });
      expect(metrics.page.scrollWidth).toBeLessThanOrEqual(metrics.page.clientWidth);
      for (const [name, element] of Object.entries(metrics.elements)) {
        if (name === 'alert' && !element) continue;
        expect(element, `${label}:${name} should be present`).not.toBeNull();
        expect(element?.x, `${label}:${name} left`).toBeGreaterThanOrEqual(0);
        expect(element?.right, `${label}:${name} right`).toBeLessThanOrEqual(metrics.viewport.width);
      }
      const path = testInfo.outputPath(`setup-mobile-${label}.metrics.json`);
      await writeFile(path, `${JSON.stringify(metrics, null, 2)}\n`);
      await testInfo.attach(`setup-mobile-${label}-metrics`, { path, contentType: 'application/json' });
      return metrics;
    };

    await page.setViewportSize({ width: 320, height: 667 });
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);
    await page.locator('#username').fill(E2E_ADMIN.username);
    await page.locator('#password').fill('short');
    await page.locator('#confirmPassword').fill('short');
    await page.locator('form button[type="submit"]').scrollIntoViewIfNeeded();
    await collectMetrics('320x667-before-failure');

    const failedSetupResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/auth/setup') && response.request().method() === 'POST',
    );
    await page.locator('form button[type="submit"]').click();
    expect((await failedSetupResponse).status()).toBe(400);
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/\S+/);
    await collectMetrics('320x667-failure');
    const failureShot = testInfo.outputPath('setup-mobile-320x667-failure.png');
    await page.screenshot({ path: failureShot, fullPage: false, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('setup-mobile-320x667-failure', { path: failureShot, contentType: 'image/png' });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('#password').fill(E2E_ADMIN.password);
    await page.locator('#confirmPassword').fill(E2E_ADMIN.password);
    await page.locator('form button[type="submit"]').scrollIntoViewIfNeeded();
    await collectMetrics('375x812-before-success');
    const successReadyShot = testInfo.outputPath('setup-mobile-375x812-ready.png');
    await page.screenshot({ path: successReadyShot, fullPage: false, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('setup-mobile-375x812-ready', { path: successReadyShot, contentType: 'image/png' });

    const successfulSetupResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/auth/setup') && response.request().method() === 'POST',
    );
    await page.locator('form button[type="submit"]').click();
    expect((await successfulSetupResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/login$/);

    const setupStateAfterRegistration = await request.get('/api/v1/auth/needs-setup');
    expect(setupStateAfterRegistration.ok()).toBeTruthy();
    await expect(setupStateAfterRegistration.json()).resolves.toEqual({ needsSetup: false });
  });
});

test('logs in, establishes a server session, and opens the dashboard', async ({ page, context }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);

  await page.locator('#username').fill(E2E_ADMIN.username);
  await page.locator('#password').fill(E2E_ADMIN.password);

  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
  );
  await page.locator('form button[type="submit"]').click();

  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);

  const authStatus = await context.request.get('/api/v1/auth/status');
  expect(authStatus.ok()).toBeTruthy();
  await expect(authStatus.json()).resolves.toMatchObject({
    isAuthenticated: true,
    user: { username: E2E_ADMIN.username },
  });
});
