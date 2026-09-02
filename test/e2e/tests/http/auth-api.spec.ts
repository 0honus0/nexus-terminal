import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';

test.describe('authenticated HTTP API', () => {
  test('rejects unauthenticated access to auth status', async ({ request }) => {
    const response = await request.get('/api/v1/auth/status');
    expect(response.status()).toBe(401);
  });

  test('logs in through HTTP and accesses protected APIs', async ({ request }) => {
    await loginAsInitialAdmin(request);

    const authStatus = await request.get('/api/v1/auth/status');
    expect(authStatus.ok()).toBeTruthy();
    await expect(authStatus.json()).resolves.toMatchObject({
      isAuthenticated: true,
      user: { username: E2E_ADMIN.username },
    });

    const settingsResponse = await request.get('/api/v1/settings');
    expect(settingsResponse.ok()).toBeTruthy();
  });
});
