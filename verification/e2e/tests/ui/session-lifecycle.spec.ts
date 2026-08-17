import { expect, test } from '@playwright/test';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const WRONG_PASSWORD = 'Definitely-Wrong-E2E-Password!';

test('invalid password login stays unauthenticated and surfaces the login failure', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
  expect((await context.request.post('/api/v1/auth/logout')).ok()).toBeTruthy();

  await step('submit an invalid password through the real login form', async () => {
    await page.goto('/login');
    await page.locator('#username').fill(E2E_ADMIN.username);
    await page.locator('#password').fill(WRONG_PASSWORD);

    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
    );
    await page.locator('form button[type="submit"]').click();
    const response = await responsePromise;

    expect(response.status()).toBe(401);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.text-error').filter({ hasText: /.+/ }).first()).toBeVisible();
  });

  await step('the server session remains unauthenticated after the failed login', async () => {
    const status = await context.request.get('/api/v1/auth/status');
    expect(status.status()).toBe(401);
    const body = await status.json() as { message?: string };
    expect(body.message).toBeTruthy();
  });
});

test('navigation logout clears the server session and protects authenticated routes', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();

  await step('logout from the authenticated navigation bar', async () => {
    await page.goto('/');
    const logoutResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST',
    );
    await page.getByRole('link', { name: 'Logout', exact: true }).click();
    expect((await logoutResponse).ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/login$/);
  });

  await step('the session is cleared and a protected route redirects back to login', async () => {
    const status = await context.request.get('/api/v1/auth/status');
    expect(status.status()).toBe(401);
    const body = await status.json() as { message?: string };
    expect(body.message).toBeTruthy();

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });
});
