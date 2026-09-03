import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN } from '../../support/auth';

test.use({ e2eDatabaseMode: 'empty' });

test.describe.serial('initial setup and login', () => {
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
});
