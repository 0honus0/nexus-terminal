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

  test('rejects invalid bounded settings instead of persisting them', async ({ request }) => {
    await loginAsInitialAdmin(request);
    const beforeResponse = await request.get('/api/v1/settings');
    expect(beforeResponse.ok()).toBeTruthy();
    const before = (await beforeResponse.json()) as {
      statusMonitorIntervalSeconds?: number;
      dockerStatusIntervalSeconds?: number;
      terminalScrollbackLimit?: number;
      statusMonitorScale?: number;
      fileManagerRowSizeMultiplier?: number;
      quickCommandRowSizeMultiplier?: number;
    };

    for (const data of [
      { statusMonitorIntervalSeconds: 0 },
      { dockerStatusIntervalSeconds: 0 },
      { terminalScrollbackLimit: -1 },
      { statusMonitorScale: 0.64 },
      { fileManagerRowSizeMultiplier: 2.01 },
      { quickCommandRowSizeMultiplier: 0.49 },
    ]) {
      const response = await request.put('/api/v1/settings', { data });
      expect(response.status()).toBe(400);
    }

    const afterResponse = await request.get('/api/v1/settings');
    expect(afterResponse.ok()).toBeTruthy();
    const after = (await afterResponse.json()) as typeof before;
    expect(after.statusMonitorIntervalSeconds).toBe(before.statusMonitorIntervalSeconds);
    expect(after.dockerStatusIntervalSeconds).toBe(before.dockerStatusIntervalSeconds);
    expect(after.terminalScrollbackLimit).toBe(before.terminalScrollbackLimit);
    expect(after.statusMonitorScale).toBe(before.statusMonitorScale);
    expect(after.fileManagerRowSizeMultiplier).toBe(before.fileManagerRowSizeMultiplier);
    expect(after.quickCommandRowSizeMultiplier).toBe(before.quickCommandRowSizeMultiplier);
  });
});
