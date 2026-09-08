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

  test('uses one clean settings DTO and retires split preference endpoints', async ({ request }) => {
    await loginAsInitialAdmin(request);
    const beforeResponse = await request.get('/api/v1/settings');
    expect(beforeResponse.ok()).toBeTruthy();
    const before = (await beforeResponse.json()) as {
      navBarVisible?: boolean;
      showConnectionTags?: boolean;
      showQuickCommandTags?: boolean;
      showStatusMonitorIpAddress?: boolean;
    };
    expect(before).not.toHaveProperty('ipWhitelistEnabled');

    try {
      const update = await request.put('/api/v1/settings', {
        data: {
          navBarVisible: false,
          showConnectionTags: false,
          showQuickCommandTags: false,
          showStatusMonitorIpAddress: true,
        },
      });
      expect(update.ok()).toBeTruthy();

      const settingsResponse = await request.get('/api/v1/settings');
      expect(settingsResponse.ok()).toBeTruthy();
      const settings = (await settingsResponse.json()) as Record<string, unknown>;
      expect(settings).toMatchObject({
        navBarVisible: false,
        showConnectionTags: false,
        showQuickCommandTags: false,
        showStatusMonitorIpAddress: true,
      });
      for (const legacyName of [
        'nav_bar_visible',
        'show_connection_tags',
        'show_quick_command_tags',
        'show_status_monitor_ip_address',
      ])
        expect(settings).not.toHaveProperty(legacyName);

      for (const path of [
        '/api/v1/settings/nav-bar-visibility',
        '/api/v1/settings/show-connection-tags',
        '/api/v1/settings/show-quick-command-tags',
        '/api/v1/settings/show-status-monitor-ip-address',
      ]) {
        expect((await request.get(path)).status()).toBe(404);
      }
    } finally {
      const restore = await request.put('/api/v1/settings', {
        data: {
          navBarVisible: before.navBarVisible ?? true,
          showConnectionTags: before.showConnectionTags ?? true,
          showQuickCommandTags: before.showQuickCommandTags ?? true,
          showStatusMonitorIpAddress: before.showStatusMonitorIpAddress ?? false,
        },
      });
      expect(restore.ok()).toBeTruthy();
    }
  });

  test('notification HTTP responses redact stored provider secrets', async ({ request }) => {
    await loginAsInitialAdmin(request);
    const suffix = crypto.randomUUID();
    const createdIds: number[] = [];
    const cases = [
      {
        channelType: 'email',
        name: `E2E redacted email ${suffix}`,
        config: {
          to: 'recipient@example.test',
          smtpHost: '127.0.0.1',
          smtpPort: 22224,
          smtpSecure: false,
          smtpUser: 'e2e-user',
          smtpPass: 'test-value-not-for-use',
          from: 'nexus@example.test',
        },
        secretKey: 'smtpPass',
      },
      {
        channelType: 'telegram',
        name: `E2E redacted telegram ${suffix}`,
        config: {
          botToken: 'test-value-not-for-use',
          chatId: 'e2e-chat',
          customDomain: 'https://example.test',
        },
        secretKey: 'botToken',
      },
    ] as const;

    try {
      for (const item of cases) {
        const create = await request.post('/api/v1/notifications', {
          data: {
            channelType: item.channelType,
            name: item.name,
            enabled: false,
            config: item.config,
            enabledEvents: ['LOGIN_SUCCESS'],
          },
        });
        expect(create.status()).toBe(201);
        const created = (await create.json()) as { id: number; config: Record<string, unknown> };
        createdIds.push(created.id);
        expect(created.config).not.toHaveProperty(item.secretKey);
      }

      const list = await request.get('/api/v1/notifications');
      expect(list.ok()).toBeTruthy();
      const settings = (await list.json()) as Array<{ name: string; config: Record<string, unknown> }>;
      for (const item of cases) {
        const setting = settings.find((candidate) => candidate.name === item.name);
        expect(setting).toBeTruthy();
        expect(setting!.config).not.toHaveProperty(item.secretKey);
      }
    } finally {
      for (const id of createdIds) await request.delete(`/api/v1/notifications/${id}`).catch(() => undefined);
    }
  });
});
