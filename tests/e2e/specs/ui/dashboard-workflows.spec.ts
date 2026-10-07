import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { E2E_SSH, configureSshE2eSettings, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace } from '../../support/ws';
import { selectUiOption } from '../../support/ui-select';

const ALPHA_NAME = 'E2E Dashboard Alpha';
const BETA_NAME = 'E2E Dashboard Beta';
const ALPHA_TAG = 'E2E Dashboard Alpha Tag';
const BETA_TAG = 'E2E Dashboard Beta Tag';
const EMPTY_TAG = 'E2E Dashboard Empty Tag';
const DASHBOARD_DARK_THEME = {
  '--app-bg-color': '#212529',
  '--text-color': '#e9ecef',
  '--text-color-secondary': '#adb5bd',
  '--border-color': '#495057',
  '--link-color': '#BB86FC',
  '--link-hover-color': '#D1A9FF',
  '--link-active-color': '#A06CD5',
  '--link-active-bg-color': 'rgba(160, 108, 213, 0.2)',
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)',
  '--header-bg-color': '#343a40',
  '--footer-bg-color': '#343a40',
  '--button-bg-color': 'var(--link-active-color)',
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#8E44AD',
  '--icon-color': 'var(--text-color-secondary)',
  '--icon-hover-color': 'var(--link-hover-color)',
  '--split-line-color': 'var(--border-color)',
  '--split-line-hover-color': 'var(--border-color)',
  '--input-bg-color': '#2b3035',
  '--input-text-color': 'var(--text-color)',
  '--input-placeholder-color': 'var(--text-color-secondary)',
  '--input-disabled-bg-color': '#343a40',
  '--input-disabled-text-color': '#adb5bd',
  '--input-disabled-border-color': '#495057',
  '--input-focus-border-color': 'var(--link-active-color)',
  '--input-focus-glow': 'var(--link-active-color)',
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.8)',
  '--color-success': '#5cb85c',
  '--color-error': '#d9534f',
  '--color-warning': '#f0ad4e',
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};

async function cleanupDashboardFixtures(request: APIRequestContext): Promise<void> {
  const connectionsResponse = await request.get('/api/v1/connections');
  expect(connectionsResponse.ok()).toBeTruthy();
  const connections = (await connectionsResponse.json()) as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) => item.name === ALPHA_NAME || item.name === BETA_NAME)) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }

  const tagsResponse = await request.get('/api/v1/tags');
  expect(tagsResponse.ok()).toBeTruthy();
  const tags = (await tagsResponse.json()) as Array<{ id: number; name: string }>;
  for (const tag of tags.filter((item) => [ALPHA_TAG, BETA_TAG, EMPTY_TAG].includes(item.name))) {
    expect((await request.delete(`/api/v1/tags/${tag.id}`)).ok()).toBeTruthy();
  }
}

async function switchInterfaceToChinese(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('tab', { name: 'System' })).toBeVisible();
  await page.getByRole('tab', { name: 'System' }).click();
  const language = page.locator('#languageSelect');
  await expect(language).toBeVisible();
  await selectUiOption(language, 'zh-CN');
  const save = page.waitForResponse(
    (response) => response.url().includes('/api/v1/settings') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save Language' }).click();
  expect((await save).ok()).toBeTruthy();
  await expect(page.getByRole('tab', { name: '系统' })).toBeVisible();
}

async function createTag(request: APIRequestContext, name: string): Promise<number> {
  const response = await request.post('/api/v1/tags', { data: { name } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { tag: { id: number } }).tag.id;
}

async function createConnection(
  request: APIRequestContext,
  name: string,
  username: string,
  host: string,
  tagId: number,
): Promise<number> {
  const create = await request.post('/api/v1/connections', {
    data: {
      name,
      type: 'SSH',
      host,
      port: 22,
      username,
      authMethod: 'password',
      password: 'dashboard-e2e-not-used',
      notes: `${name} notes`,
    },
  });
  expect(create.status()).toBe(201);
  const id = ((await create.json()) as { connection: { id: number } }).connection.id;

  const assignTag = await request.post('/api/v1/connections/add-tag', {
    data: { connectionIds: [id], tagId: tagId },
  });
  expect(assignTag.ok()).toBeTruthy();
  return id;
}

const dashboardRoot = (page: Page) => page.locator('.dashboard-page');
const connectionRow = (page: Page, name: string) =>
  page.locator('.dashboard-quick-connect-grid > li').filter({ has: page.getByTitle(name, { exact: true }) });
const remoteCard = (page: Page, address: string) =>
  page.locator('article.dashboard-host-card').filter({ hasText: address });
const quickConnectPanel = (page: Page) => page.locator('.dashboard-workspace > section').first();
const resourcePanel = (page: Page) => page.locator('.dashboard-workspace > section').nth(1);
const tagFilter = (page: Page) => page.getByRole('combobox', { name: '按标签筛选', exact: true });
const sortFilter = (page: Page) => page.getByRole('combobox', { name: '排序方式', exact: true });

test('desktop dashboard exposes suspended sessions without changing the main workspace layout', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as { dashboardShowRemoteResources?: boolean };
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { dashboardShowRemoteResources: true },
      })
    ).ok(),
  ).toBeTruthy();
  const connectionId = await ensureTestSshConnection(context.request);
  const createdSuspendedIds: string[] = [];

  const createSuspended = async (label: string) => {
    const workspace = await openWorkspaceSession(
      context.request,
      connectionId,
      `dashboard-suspended-${label}-${crypto.randomUUID()}`,
    );
    await requestWorkspace(workspace.socket, 'suspend.mark');
    await closeWebSocket(workspace.socket);

    let suspendedId = '';
    await expect
      .poll(
        async () => {
          const response = await context.request.get('/api/v1/ssh-suspend/suspended-sessions');
          expect(response.ok()).toBeTruthy();
          const sessions = (await response.json()) as Array<{
            id: string;
            originalWorkspaceId: string;
            status: 'active' | 'disconnected';
          }>;
          const match = sessions.find(
            (session) => session.originalWorkspaceId === workspace.workspaceId && session.status === 'active',
          );
          suspendedId = match?.id ?? '';
          return Boolean(match);
        },
        { timeout: 10_000 },
      )
      .toBeTruthy();
    createdSuspendedIds.push(suspendedId);
    return suspendedId;
  };

  try {
    const firstSuspendedId = await createSuspended('first');
    await page.setViewportSize({ width: 1440, height: 900 });
    const firstCatalogResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/ssh-suspend/suspended-sessions') && response.ok(),
    );
    await page.goto('/');
    await firstCatalogResponse;

    const dashboard = dashboardRoot(page);
    const workspace = dashboard.locator('.dashboard-workspace');
    const quickConnect = quickConnectPanel(page);
    const resources = resourcePanel(page);
    const suspendedEntry = dashboard.getByRole('button', { name: /^Suspended sessions/ });
    await expect(suspendedEntry).toBeVisible();
    await expect(suspendedEntry).toContainText('Suspended sessions');
    await expect(workspace).toBeVisible();

    const [workspaceBox, quickConnectBox, resourcesBox] = await Promise.all([
      workspace.boundingBox(),
      quickConnect.boundingBox(),
      resources.boundingBox(),
    ]);
    expect(workspaceBox).toBeTruthy();
    expect(quickConnectBox).toBeTruthy();
    expect(resourcesBox).toBeTruthy();
    expect(Math.abs(quickConnectBox!.y - resourcesBox!.y)).toBeLessThanOrEqual(2);

    // Prime the shared catalog on the dashboard, then create another suspended record.
    // Opening the manager must force a fresh request rather than waiting for the polling cache.
    const secondSuspendedId = await createSuspended('second');
    let catalogRequests = 0;
    const countCatalogRequest = (request: { url(): string }) => {
      if (request.url().includes('/api/v1/ssh-suspend/suspended-sessions')) catalogRequests += 1;
    };
    page.on('request', countCatalogRequest);
    const requestsBeforeOpen = catalogRequests;
    await suspendedEntry.click();
    await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
    const dialog = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => catalogRequests, { timeout: 1_200 }).toBeGreaterThan(requestsBeforeOpen);
    await expect(dialog.locator(`[data-suspend-id="${firstSuspendedId}"]`)).toBeVisible();
    await expect(dialog.locator(`[data-suspend-id="${secondSuspendedId}"]`)).toBeVisible();
    page.off('request', countCatalogRequest);
  } finally {
    for (const suspendedId of createdSuspendedIds) {
      const response = await context.request.delete(`/api/v1/ssh-suspend/terminate/${encodeURIComponent(suspendedId)}`);
      expect([200, 404]).toContain(response.status());
    }
    expect(
      (
        await context.request.put('/api/v1/settings', {
          data: { dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? true },
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test('dashboard reconnect completion refreshes recent connection without navigating back to Workspace', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  // Prime lastConnectedAt so the dashboard exposes the dedicated Reconnect action.
  const primingSession = await openWorkspaceSession(
    context.request,
    connectionId,
    `dashboard-reconnect-prime-${crypto.randomUUID()}`,
  );
  await closeWebSocket(primingSession.socket);

  const beforeAudit = await context.request.get('/api/v1/audit-logs', {
    params: { limit: 1, offset: 0, actionType: 'SSH_CONNECT_SUCCESS' },
  });
  expect(beforeAudit.ok()).toBeTruthy();
  const beforeSuccessCount = ((await beforeAudit.json()) as { total: number }).total;

  let releaseConnectionDetail: (() => void) | undefined;
  const connectionDetailGate = new Promise<void>((resolve) => {
    releaseConnectionDetail = resolve;
  });
  let markConnectionDetailStarted: (() => void) | undefined;
  const connectionDetailStarted = new Promise<void>((resolve) => {
    markConnectionDetailStarted = resolve;
  });

  await page.route(`**/api/v1/connections/${connectionId}`, async (route) => {
    const response = await route.fetch();
    markConnectionDetailStarted?.();
    await connectionDetailGate;
    await route.fulfill({ response });
  });

  try {
    await page.goto('/');
    const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true });
    const row = connectionRow(page, 'E2E SSH');
    await expect(reconnect).toBeVisible();
    await expect(row).toBeVisible();
    const previousLastConnectedAt = Number(await row.getAttribute('data-last-connected-at'));
    expect(previousLastConnectedAt).toBeGreaterThan(0);

    // lastConnectedAt has one-second precision. Ensure the reconnect writes a distinguishable value.
    await page.waitForTimeout(1_100);
    await reconnect.click();
    await connectionDetailStarted;

    // The one-shot connectionId query is consumed immediately, before SSH finishes connecting.
    await expect(page).toHaveURL(/\/workspace$/);
    await page.locator('.app-nav-links').getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    releaseConnectionDetail?.();
    await expect
      .poll(
        async () => {
          const response = await context.request.get('/api/v1/audit-logs', {
            params: { limit: 1, offset: 0, actionType: 'SSH_CONNECT_SUCCESS' },
          });
          expect(response.ok()).toBeTruthy();
          return ((await response.json()) as { total: number }).total;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(beforeSuccessCount);

    // Successful background completion must update the already-mounted Dashboard store without a page reload.
    await expect
      .poll(async () => Number(await row.getAttribute('data-last-connected-at')), { timeout: 10_000 })
      .toBeGreaterThan(previousLastConnectedAt);
    await expect(page).toHaveURL(/\/$/);

    // The connected session is still available when the user later opens Workspace explicitly.
    await page.getByRole('link', { name: 'Terminal', exact: true }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole('tablist').getByRole('tab', { selected: true })).toHaveAttribute(
      'data-session-state',
      'connected',
    );
  } finally {
    releaseConnectionDetail?.();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('SSH resource cards appear while their status requests are pending', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await ensureTestSshConnection(context.request);

  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as {
    language?: string;
    dashboardShowLocalResources?: boolean;
    dashboardShowRemoteResources?: boolean;
  };

  const enableRemoteResources = await context.request.put('/api/v1/settings', {
    data: { dashboardShowRemoteResources: true },
  });
  expect(enableRemoteResources.ok()).toBeTruthy();

  let releaseRemoteResources: (() => void) | undefined;
  const remoteResourcesReleased = new Promise<void>((resolve) => {
    releaseRemoteResources = resolve;
  });
  let markRemoteRequestStarted: (() => void) | undefined;
  const remoteRequestStarted = new Promise<void>((resolve) => {
    markRemoteRequestStarted = resolve;
  });

  await page.route('**/api/v1/system/ssh-resources/*', async (route) => {
    markRemoteRequestStarted?.();
    const backendResponse = await route.fetch();
    await remoteResourcesReleased;
    await route.fulfill({ response: backendResponse });
  });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await remoteRequestStarted;

    const list = resourcePanel(page);
    await expect(list).toBeVisible();
    await expect(remoteCard(page, `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}`)).toBeVisible();
    await expect(list.locator('.ui-spinner')).toHaveCount(0);
  } finally {
    releaseRemoteResources?.();
    await page.unrouteAll({ behavior: 'wait' });
    const restoreSettings = await context.request.put('/api/v1/settings', {
      data: {
        dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? true,
      },
    });
    expect(restoreSettings.ok()).toBeTruthy();
  }
});

test('a slow SSH resource does not hold back another host on the dashboard', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const goodConnectionId = await ensureTestSshConnection(context.request);
  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as { dashboardShowRemoteResources?: boolean };
  expect(
    (await context.request.put('/api/v1/settings', { data: { dashboardShowRemoteResources: true } })).ok(),
  ).toBeTruthy();
  const badHost = '198.51.100.88';
  const badPort = 2222;
  const create = await context.request.post('/api/v1/connections', {
    data: {
      name: 'E2E Slow SSH Resource',
      type: 'SSH',
      host: badHost,
      port: badPort,
      username: 'slow',
      authMethod: 'password',
      password: 'unused',
    },
  });
  expect(create.status()).toBe(201);
  const badConnectionId = ((await create.json()) as { connection: { id: number } }).connection.id;
  let releaseSlow: (() => void) | undefined;
  const slowReleased = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });

  await page.route('**/api/v1/system/ssh-resources/*', async (route) => {
    const id = Number(route.request().url().split('/').at(-1));
    if (id === badConnectionId) {
      await slowReleased;
      await route.abort('failed');
    } else if (id === goodConnectionId) {
      await route.fulfill({
        json: {
          key: `${E2E_SSH.host.toLowerCase()}:${E2E_SSH.port}`,
          connectionId: goodConnectionId,
          name: 'E2E SSH',
          username: E2E_SSH.username,
          host: E2E_SSH.host,
          port: E2E_SSH.port,
          status: { cpuPercent: 7, memPercent: 8, timestamp: Date.now() },
          checkedAt: Date.now(),
        },
      });
    } else await route.abort('failed');
  });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const goodCard = remoteCard(page, `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}`);
    const badCard = remoteCard(page, `slow@${badHost}:${badPort}`);
    await expect(goodCard).toContainText('7%');
    await expect(goodCard.getByText('SSH', { exact: true })).toHaveCount(0);
    await expect(badCard).toBeVisible();
    await expect(badCard).not.toContainText('Network Error');
    releaseSlow?.();
    await expect(badCard).toContainText('Network Error');
    await expect(goodCard).toContainText('7%');
  } finally {
    releaseSlow?.();
    await page.unrouteAll({ behavior: 'wait' });
    expect((await context.request.delete(`/api/v1/connections/${badConnectionId}`)).ok()).toBeTruthy();
    expect(
      (
        await context.request.put('/api/v1/settings', {
          data: { dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? true },
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test('resource failures stay inside their panels and do not block quick connect', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as {
    dashboardShowLocalResources?: boolean;
    dashboardShowRemoteResources?: boolean;
  };
  const enableResources = await context.request.put('/api/v1/settings', {
    data: { dashboardShowLocalResources: true, dashboardShowRemoteResources: true },
  });
  expect(enableResources.ok()).toBeTruthy();
  const connectionId = await ensureTestSshConnection(context.request);

  await page.route('**/api/v1/system/status', async (route) => {
    await route.abort('failed');
  });
  await page.route('**/api/v1/system/ssh-resources/*', async (route) => {
    await route.abort('failed');
  });

  try {
    await page.goto('/');
    const dashboard = dashboardRoot(page);
    const local = dashboard.locator('.dashboard-overview-local');
    const remoteList = resourcePanel(page);
    const remoteError = remoteCard(page, `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}`);
    const connectionList = quickConnectPanel(page).getByRole('list');
    const row = connectionRow(page, 'E2E SSH');

    await expect(local).toContainText('Network Error');
    await expect(remoteError).toContainText('Network Error');
    await expect(connectionList).toBeVisible();
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Connect E2E SSH', exact: true })).toBeEnabled();

    await expect(remoteList).toBeVisible();
    const card = row.getByRole('button', { name: 'Connect E2E SSH', exact: true });
    await expect(card.getByText('Connect', { exact: true })).toHaveCount(0);
    await card.focus();
    await card.press('Enter');
    await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
      timeout: 35_000,
    });
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    const restoreSettings = await context.request.put('/api/v1/settings', {
      data: {
        dashboardShowLocalResources: originalSettings.dashboardShowLocalResources ?? true,
        dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? true,
      },
    });
    expect(restoreSettings.ok()).toBeTruthy();
  }
});

test('dashboard filters connections and persists tag and sort preferences across reloads', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await cleanupDashboardFixtures(context.request);
  await resetTestSshFilesystem();

  const originalSettingsResponse = await context.request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as {
    language?: string;
    dashboardShowLocalResources?: boolean;
    dashboardShowRemoteResources?: boolean;
    remoteHostRefreshIntervalSeconds?: number;
  };
  const originalAppearanceResponse = await context.request.get('/api/v1/appearance');
  expect(originalAppearanceResponse.ok()).toBeTruthy();
  const originalAppearance = (await originalAppearanceResponse.json()) as {
    customUiTheme?: string;
    windowThemeColor?: string;
  };

  const normalizeSettings = await context.request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      dashboardShowLocalResources: true,
      dashboardShowRemoteResources: true,
      remoteHostRefreshIntervalSeconds: 30,
    },
  });
  expect(normalizeSettings.ok()).toBeTruthy();
  const darkAppearance = await context.request.put('/api/v1/appearance', {
    data: {
      customUiTheme: JSON.stringify(DASHBOARD_DARK_THEME),
      windowThemeColor: '#343a40',
    },
  });
  expect(darkAppearance.ok()).toBeTruthy();

  const systemStatusResponse = await context.request.get('/api/v1/system/status');
  expect(systemStatusResponse.ok()).toBeTruthy();
  const systemStatus = (await systemStatusResponse.json()) as {
    cpuPercent: number;
    memPercent: number;
    memUsed: number;
    memTotal: number;
    diskPercent?: number;
  };
  expect(systemStatus.cpuPercent).toBeGreaterThanOrEqual(0);
  expect(systemStatus.cpuPercent).toBeLessThanOrEqual(100);
  expect(systemStatus.memPercent).toBeGreaterThanOrEqual(0);
  expect(systemStatus.memPercent).toBeLessThanOrEqual(100);
  expect(systemStatus.memUsed).toBeGreaterThanOrEqual(0);
  expect(systemStatus.memTotal).toBeGreaterThan(0);
  if (systemStatus.diskPercent !== undefined) {
    expect(systemStatus.diskPercent).toBeGreaterThanOrEqual(0);
    expect(systemStatus.diskPercent).toBeLessThanOrEqual(100);
  }

  const primedSshResourcesResponse = await context.request.get('/api/v1/system/ssh-resources');
  expect(primedSshResourcesResponse.ok()).toBeTruthy();

  const alphaTagId = await createTag(context.request, ALPHA_TAG);
  const betaTagId = await createTag(context.request, BETA_TAG);
  const emptyTagId = await createTag(context.request, EMPTY_TAG);
  const alphaId = await createConnection(context.request, ALPHA_NAME, 'dashboard-alpha', '192.0.2.10', alphaTagId);
  const betaId = await createConnection(context.request, BETA_NAME, 'dashboard-beta', '192.0.2.20', betaTagId);
  const sshConnectionId = await ensureTestSshConnection(context.request);

  try {
    await switchInterfaceToChinese(page);
    await page.goto('/');
    const dashboard = dashboardRoot(page);
    await expect(dashboard).toBeVisible();
    await expect(resourcePanel(page)).toBeVisible();
    await expect(dashboard.locator('.dashboard-overview-local')).toBeVisible();
    await expect(dashboard.locator('article.dashboard-host-card')).toHaveCount(3, { timeout: 20_000 });
    await expect(dashboard.locator('.dashboard-overview-local')).toContainText('CPU');
    const alphaRow = connectionRow(page, ALPHA_NAME);
    const betaRow = connectionRow(page, BETA_NAME);
    await expect(alphaRow).toContainText(ALPHA_NAME);
    await expect(betaRow).toContainText(BETA_NAME);

    await step('search matches username and host fields', async () => {
      const search = dashboard.locator('input[type="search"]');
      await search.fill('dashboard-alpha');
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeHidden();

      await search.fill('192.0.2.20');
      await expect(betaRow).toBeVisible();
      await expect(alphaRow).toBeHidden();
      await search.fill('');
    });

    await step('an empty selected tag uses the restored tag-specific empty state', async () => {
      await selectUiOption(tagFilter(page), String(emptyTagId));
      await expect(dashboard.getByText('该标签下没有连接记录', { exact: true })).toBeVisible();
      await selectUiOption(tagFilter(page), String(alphaTagId));
    });

    await step('tag filtering persists across a full page reload', async () => {
      await selectUiOption(tagFilter(page), String(alphaTagId));
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeHidden();

      expect((await context.request.delete(`/api/v1/tags/${emptyTagId}`)).ok()).toBeTruthy();
      await page.reload();
      await expect(tagFilter(page)).toHaveAttribute('data-value', String(alphaTagId));
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeHidden();
    });

    await step('sort field and order persist independently from the connection data', async () => {
      await selectUiOption(tagFilter(page), '');
      await selectUiOption(sortFilter(page), 'name');
      await dashboard.locator('.dashboard-toolbar button').last().click();

      await page.reload();
      const finalDashboard = dashboardRoot(page);
      await expect(sortFilter(page)).toHaveAttribute('data-value', 'name');
      const visibleFixtureRows = finalDashboard
        .locator('.dashboard-quick-connect-grid > li')
        .filter({ hasText: /E2E Dashboard (Alpha|Beta)/ });
      await expect(visibleFixtureRows).toHaveCount(2);
      const texts = await visibleFixtureRows.allTextContents();
      expect(texts.map((text) => (text.includes(ALPHA_NAME) ? ALPHA_NAME : BETA_NAME))).toEqual([
        ALPHA_NAME,
        BETA_NAME,
      ]);

      await expect(finalDashboard.locator('.dashboard-overview-metrics')).toBeVisible();
      await expect(finalDashboard.locator('a[href="/connections"]')).toBeVisible();
      await expect(alphaRow.getByRole('button')).toBeVisible();
      await expect(betaRow.getByRole('button')).toBeVisible();
    });

    await step('dashboard renders configured SSH resources and keeps the current desktop layout stable', async () => {
      const remoteCards = page.locator('article.dashboard-host-card');
      const e2eHostCard = remoteCards.filter({ hasText: `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port}` });

      await expect(remoteCards).toHaveCount(3, { timeout: 20_000 });
      await expect(e2eHostCard).toHaveCount(1);
      await expect(e2eHostCard).toContainText('CPU', { timeout: 20_000 });
      await expect(
        e2eHostCard
          .locator('div.flex.flex-wrap.items-baseline')
          .filter({ hasText: /^\d+(?:\.\d+)? (?:GB|TB)\s*\/\s*\d+(?:\.\d+)? (?:GB|TB)$/ }),
      ).toHaveText(/^\d+(?:\.\d+)? (?:GB|TB)\s*\/\s*\d+(?:\.\d+)? (?:GB|TB)$/);
      await expect(page.getByText('活动 SSH 会话', { exact: true })).toHaveCount(0);

      await page.setViewportSize({ width: 1440, height: 900 });
      const dashboard = dashboardRoot(page);
      const workspace = page.locator('.dashboard-workspace');
      const quickConnect = quickConnectPanel(page);
      const recentActivity = dashboard.getByRole('complementary');
      const resources = resourcePanel(page);
      const connectionList = quickConnect.getByRole('list');
      const resourceList = resources.locator('.ui-scroll-area__viewport');
      const localResource = dashboard.locator('.dashboard-overview-local');

      await expect(workspace).toBeVisible();
      await expect(quickConnect).toBeVisible();
      await expect(recentActivity).toBeVisible();
      await expect(resources).toBeVisible();
      await expect(connectionList).toBeVisible();
      await expect(resourceList).toBeVisible();
      await expect(localResource).toBeVisible();
      await expect(localResource).toContainText('CPU');
      const recentCard = recentActivity.locator('ol > li').first();
      await expect(recentCard).toBeVisible();
      const [activityDotBox, activityTitleBox] = await Promise.all([
        recentCard.locator('.activity-dot').boundingBox(),
        recentCard.locator('.activity-title').boundingBox(),
      ]);
      expect(activityDotBox).not.toBeNull();
      expect(activityTitleBox).not.toBeNull();
      expect(
        Math.abs(activityDotBox!.y + activityDotBox!.height / 2 - (activityTitleBox!.y + activityTitleBox!.height / 2)),
      ).toBeLessThanOrEqual(1);
      await expect(resources.getByText('30 秒刷新', { exact: true })).toBeVisible();
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeVisible();

      const tagControl = tagFilter(page);
      const sortControl = sortFilter(page);
      for (const control of [tagControl, sortControl]) {
        const geometry = await control.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const label = element.querySelector(':scope > span')?.getBoundingClientRect();
          const chevron = element.querySelector('svg')?.getBoundingClientRect();
          return {
            height: box.height,
            centerY: box.top + box.height / 2,
            labelCenterY: label ? label.top + label.height / 2 : Number.NaN,
            chevronCenterY: chevron ? chevron.top + chevron.height / 2 : Number.NaN,
          };
        });
        expect(Math.abs(geometry.height - 40)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.labelCenterY - geometry.centerY)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.chevronCenterY - geometry.centerY)).toBeLessThanOrEqual(1);
      }

      await tagControl.click();
      const tagMenu = page.getByRole('listbox');
      await expect(tagMenu).toBeVisible();
      const optionCenters = await tagMenu.getByRole('option').evaluateAll((options) =>
        options.map((option) => {
          const box = option.getBoundingClientRect();
          const label = option.querySelector('span')?.getBoundingClientRect();
          return label
            ? {
                leftInset: label.left - box.left,
                rightInset: box.right - label.right,
                verticalOffset: Math.abs(label.top + label.height / 2 - (box.top + box.height / 2)),
              }
            : {
                leftInset: Number.NEGATIVE_INFINITY,
                rightInset: Number.NEGATIVE_INFINITY,
                verticalOffset: Number.POSITIVE_INFINITY,
              };
        }),
      );
      expect(optionCenters.length).toBeGreaterThan(1);
      for (const geometry of optionCenters) {
        expect(geometry.leftInset).toBeGreaterThanOrEqual(0);
        expect(geometry.rightInset).toBeGreaterThanOrEqual(0);
        expect(geometry.verticalOffset).toBeLessThanOrEqual(1);
      }
      await page.keyboard.press('Escape');
      await expect(tagMenu).toBeHidden();

      const overflow = await dashboard.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

      const workspaceBox = await workspace.boundingBox();
      const quickConnectBox = await quickConnect.boundingBox();
      const recentActivityBox = await recentActivity.boundingBox();
      const resourcesBox = await resources.boundingBox();
      const resourceListBox = await resourceList.boundingBox();
      expect(workspaceBox).not.toBeNull();
      expect(quickConnectBox).not.toBeNull();
      expect(recentActivityBox).not.toBeNull();
      expect(resourcesBox).not.toBeNull();
      expect(resourceListBox).not.toBeNull();
      expect(Math.abs((quickConnectBox?.y ?? 0) - (resourcesBox?.y ?? 0))).toBeLessThanOrEqual(2);
      expect(resourcesBox?.x ?? 0).toBeGreaterThan((quickConnectBox?.x ?? 0) + (quickConnectBox?.width ?? 0) - 2);
      expect(recentActivityBox?.y ?? 0).toBeGreaterThan(
        Math.max(
          (quickConnectBox?.y ?? 0) + (quickConnectBox?.height ?? 0),
          (resourcesBox?.y ?? 0) + (resourcesBox?.height ?? 0),
        ) - 2,
      );
      expect(Math.abs((recentActivityBox?.width ?? 0) - (workspaceBox?.width ?? 0))).toBeLessThanOrEqual(2);
      expect((recentActivityBox?.y ?? 0) + Math.min(recentActivityBox?.height ?? 0, 120)).toBeLessThanOrEqual(900);

      const remoteResourceBoxes = await remoteCards.evaluateAll((cards) =>
        cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }),
      );
      const resourceScroll = await resourceList.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
      expect(remoteResourceBoxes).toHaveLength(3);
      expect(['auto', 'scroll']).toContain(resourceScroll.overflowY);
      expect(resourceScroll.scrollHeight).toBeGreaterThanOrEqual(resourceScroll.clientHeight);
      for (const box of remoteResourceBoxes) {
        expect(box.left).toBeGreaterThanOrEqual((resourceListBox?.x ?? 0) - 2);
        expect(box.right).toBeLessThanOrEqual((resourceListBox?.x ?? 0) + (resourceListBox?.width ?? 0) + 2);
        expect(box.top).toBeGreaterThanOrEqual((resourceListBox?.y ?? 0) - 2);
      }

      await captureFunctionalScreenshot(page, 'dashboard-home.png', { viewport: { width: 1440, height: 900 } });
    });

    await step('local and remote dashboard resource sections honor their independent settings', async () => {
      const remoteOnly = await context.request.put('/api/v1/settings', {
        data: {
          dashboardShowLocalResources: false,
          dashboardShowRemoteResources: true,
        },
      });
      expect(remoteOnly.ok()).toBeTruthy();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(resourcePanel(page)).toBeVisible();
      await expect(page.locator('.dashboard-overview-local')).toHaveCount(0);
      await expect(page.locator('article.dashboard-host-card')).toHaveCount(3, { timeout: 20_000 });

      const localOnly = await context.request.put('/api/v1/settings', {
        data: {
          dashboardShowLocalResources: true,
          dashboardShowRemoteResources: false,
        },
      });
      expect(localOnly.ok()).toBeTruthy();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.dashboard-overview-local')).toBeVisible();
      await expect(page.locator('article.dashboard-host-card')).toHaveCount(0);
      await expect(resourcePanel(page)).toHaveCount(0);

      const restoreBoth = await context.request.put('/api/v1/settings', {
        data: {
          dashboardShowLocalResources: true,
          dashboardShowRemoteResources: true,
        },
      });
      expect(restoreBoth.ok()).toBeTruthy();
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await step('recent activity links to the full audit log view', async () => {
      await dashboard.locator('a[href="/audit-logs"]').click();
      await expect(page).toHaveURL(/\/audit-logs$/);
      await expect(page.getByRole('heading', { name: '审计日志', exact: true })).toBeVisible();
    });
  } finally {
    await cleanupDashboardFixtures(context.request);
    const restoreSettings = await context.request.put('/api/v1/settings', {
      data: {
        language: originalSettings.language ?? 'en-US',
        dashboardShowLocalResources: originalSettings.dashboardShowLocalResources ?? true,
        dashboardShowRemoteResources: originalSettings.dashboardShowRemoteResources ?? true,
        remoteHostRefreshIntervalSeconds: originalSettings.remoteHostRefreshIntervalSeconds ?? 30,
      },
    });
    expect(restoreSettings.ok()).toBeTruthy();
    const restoreAppearance = await context.request.put('/api/v1/appearance', {
      data: {
        customUiTheme: originalAppearance.customUiTheme,
        windowThemeColor: originalAppearance.windowThemeColor,
      },
    });
    expect(restoreAppearance.ok()).toBeTruthy();
  }
});
