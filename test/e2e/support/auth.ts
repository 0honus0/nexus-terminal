import { expect, type APIRequestContext } from '@playwright/test';

export const E2E_ADMIN = {
  username: 'e2e-admin',
  password: 'E2e-Admin-Password-2026!',
} as const;

export async function ensureInitialAdmin(request: APIRequestContext): Promise<void> {
  const setupStateResponse = await request.get('/api/v1/auth/needs-setup');
  expect(setupStateResponse.ok()).toBeTruthy();
  const setupState = await setupStateResponse.json() as { needsSetup: boolean };

  if (!setupState.needsSetup) return;

  const setupResponse = await request.post('/api/v1/auth/setup', {
    data: {
      username: E2E_ADMIN.username,
      password: E2E_ADMIN.password,
      confirmPassword: E2E_ADMIN.password,
    },
  });
  expect(setupResponse.status()).toBe(201);
}

export async function loginAsInitialAdmin(request: APIRequestContext): Promise<void> {
  await ensureInitialAdmin(request);

  const loginResponse = await request.post('/api/v1/auth/login', {
    data: {
      username: E2E_ADMIN.username,
      password: E2E_ADMIN.password,
      rememberMe: false,
    },
  });
  expect(loginResponse.ok()).toBeTruthy();

  const authStatus = await request.get('/api/v1/auth/status');
  expect(authStatus.ok()).toBeTruthy();
  await expect(authStatus.json()).resolves.toMatchObject({
    isAuthenticated: true,
    user: { username: E2E_ADMIN.username },
  });
}
