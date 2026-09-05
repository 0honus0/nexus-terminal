import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const repoRoot = path.resolve(process.cwd(), '../..');
const requireFromBackend = createRequire(path.join(repoRoot, 'packages', 'backend', 'package.json'));
const speakeasy = requireFromBackend('speakeasy') as {
  totp: (options: { secret: string; encoding: string }) => string;
};

test('2FA can be enabled, required at login, verified, and disabled', async ({ request }) => {
  await loginAsInitialAdmin(request);

  let secret = '';
  await step('start and activate TOTP 2FA', async () => {
    const setup = await request.post('/api/v1/auth/2fa/setup');
    expect(setup.ok()).toBeTruthy();
    const setupBody = (await setup.json()) as { secret: string; qrCodeUrl: string };
    secret = setupBody.secret;
    expect(secret).toBeTruthy();
    expect(setupBody.qrCodeUrl).toMatch(/^data:image\/png;base64,/);

    const token = speakeasy.totp({ secret, encoding: 'base32' });
    const verify = await request.post('/api/v1/auth/2fa/verify', { data: { token } });
    expect(verify.ok()).toBeTruthy();

    const status = await request.get('/api/v1/auth/status');
    expect(status.ok()).toBeTruthy();
    await expect(status.json()).resolves.toMatchObject({
      isAuthenticated: true,
      user: { username: E2E_ADMIN.username, twoFactorEnabled: true },
    });
  });

  await step('password login is blocked behind the second factor', async () => {
    expect((await request.post('/api/v1/auth/logout')).ok()).toBeTruthy();
    const login = await request.post('/api/v1/auth/login', {
      data: {
        username: E2E_ADMIN.username,
        password: E2E_ADMIN.password,
        rememberMe: false,
      },
    });
    expect(login.ok()).toBeTruthy();
    await expect(login.json()).resolves.toMatchObject({ requiresTwoFactor: true });

    const incompleteStatus = await request.get('/api/v1/auth/status');
    expect(incompleteStatus.status()).toBe(401);
  });

  await step('a real current TOTP completes login', async () => {
    const invalid = await request.post('/api/v1/auth/login/2fa', { data: { token: '000000' } });
    expect(invalid.status()).toBe(401);

    const token = speakeasy.totp({ secret, encoding: 'base32' });
    const verify = await request.post('/api/v1/auth/login/2fa', { data: { token } });
    expect(verify.ok()).toBeTruthy();

    const status = await request.get('/api/v1/auth/status');
    expect(status.ok()).toBeTruthy();
    await expect(status.json()).resolves.toMatchObject({ isAuthenticated: true });
  });

  await step('2FA can be disabled only with the current password', async () => {
    const wrongPassword = await request.delete('/api/v1/auth/2fa', { data: { password: 'not-the-password' } });
    expect(wrongPassword.status()).toBe(400);

    const disable = await request.delete('/api/v1/auth/2fa', { data: { password: E2E_ADMIN.password } });
    expect(disable.ok()).toBeTruthy();

    const status = await request.get('/api/v1/auth/status');
    expect(status.ok()).toBeTruthy();
    await expect(status.json()).resolves.toMatchObject({
      user: { username: E2E_ADMIN.username, twoFactorEnabled: false },
    });
  });
});

test('2FA settings UI completes setup, reports errors, reloads, and disables the real server state', async ({
  page,
  context,
}) => {
  const request = context.request;
  await loginAsInitialAdmin(request);

  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Security', exact: true }).click();
    const panel = page.getByRole('heading', { name: 'Two-Factor Authentication (TOTP)', exact: true }).locator('..');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Two-factor authentication is currently disabled.');

    await step('start and activate TOTP through the Security UI', async () => {
      const setupPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/2fa/setup') && response.request().method() === 'POST',
      );
      await panel.getByRole('button', { name: 'Enable Two-Factor Authentication', exact: true }).click();
      const setupResponse = await setupPromise;
      expect(setupResponse.ok()).toBeTruthy();
      const setupBody = (await setupResponse.json()) as { secret: string; qrCodeUrl: string };
      expect(setupBody.secret).toBeTruthy();
      expect(setupBody.qrCodeUrl).toMatch(/^data:image\/png;base64,/);
      const token = speakeasy.totp({ secret: setupBody.secret, encoding: 'base32' });
      await panel.locator('#verificationCode').fill(token);
      const verifyPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/2fa/verify') && response.request().method() === 'POST',
      );
      await panel.getByRole('button', { name: 'Verify & Activate', exact: true }).click();
      expect((await verifyPromise).ok()).toBeTruthy();
      await expect(panel).toContainText('Two-factor authentication is enabled.');
      await expect(panel).toContainText('Two-factor authentication activated successfully!');
    });

    await step('reload preserves enabled 2FA state and rejects a wrong disable password', async () => {
      await page.reload();
      await page.getByRole('tab', { name: 'Security', exact: true }).click();
      const reloadedPanel = page
        .getByRole('heading', { name: 'Two-Factor Authentication (TOTP)', exact: true })
        .locator('..');
      await expect(reloadedPanel).toContainText('Two-factor authentication is enabled.');
      await reloadedPanel.locator('#disablePassword').fill('not-the-password');
      const wrongPasswordPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/2fa') && response.request().method() === 'DELETE',
      );
      await reloadedPanel.getByRole('button', { name: 'Disable Two-Factor Authentication', exact: true }).click();
      expect((await wrongPasswordPromise).status()).toBe(400);
      await expect(reloadedPanel).toContainText('当前密码不正确。');
    });

    await step('disable 2FA through the Security UI and verify the real server state', async () => {
      const reloadedPanel = page
        .getByRole('heading', { name: 'Two-Factor Authentication (TOTP)', exact: true })
        .locator('..');
      await reloadedPanel.locator('#disablePassword').fill(E2E_ADMIN.password);
      const disablePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/auth/2fa') && response.request().method() === 'DELETE',
      );
      await reloadedPanel.getByRole('button', { name: 'Disable Two-Factor Authentication', exact: true }).click();
      expect((await disablePromise).ok()).toBeTruthy();
      await expect(reloadedPanel).toContainText('Two-factor authentication disabled successfully.');
      await expect
        .poll(
          async () =>
            (await request.get('/api/v1/auth/status').then((response) => response.json())).user.twoFactorEnabled,
        )
        .toBe(false);
    });
  } finally {
    const status = await request.get('/api/v1/auth/status');
    if (status.ok() && (await status.json()).user?.twoFactorEnabled) {
      await request.delete('/api/v1/auth/2fa', { data: { password: E2E_ADMIN.password } });
    }
  }
});
