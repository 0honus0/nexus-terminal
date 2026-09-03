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
      user: { username: E2E_ADMIN.username, isTwoFactorEnabled: true },
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
      user: { username: E2E_ADMIN.username, isTwoFactorEnabled: false },
    });
  });
});
