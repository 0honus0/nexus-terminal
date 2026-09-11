import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';
import type { APIRequestContext, Page, WebSocket as PlaywrightWebSocket, WebSocketRoute } from '@playwright/test';

type AgentEnvelope<T> = { data: T; requestId: string };
type AgentErrorEnvelope = { error: { code: string; message: string }; requestId: string };

type AppSummary = {
  id: string;
  displayName: string;
  version: string;
  stateVersion: number;
  enabled: boolean;
  health: string;
  healthReason: string | null;
  runningRuns: number;
  pendingApprovals: number;
  pendingBudgetRequests: number;
};

test('Agent launcher stays passive until the user explicitly opens the Hub', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);

  await page.goto('/connections');

  const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
  const hub = page.locator('section[aria-label="Agent"]');
  await expect(launcher).toBeVisible();
  await expect(hub).toHaveCount(0);

  await page.getByTestId('connections-add-button').click({ trial: true });

  await launcher.click();
  await expect(hub).toBeVisible();
});

const csrfToken = async (request: import('@playwright/test').APIRequestContext): Promise<string> => {
  const response = await request.get('/api/v1/agent/security/csrf');
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()['cache-control']).toContain('no-store');
  const serverTimeMilliseconds = Number(response.headers()['x-agent-server-time-ms']);
  expect(Number.isSafeInteger(serverTimeMilliseconds) && serverTimeMilliseconds > 0).toBeTruthy();
  const body = (await response.json()) as AgentEnvelope<{ token: string }>;
  expect(body.requestId).toBe(response.headers()['x-request-id']);
  expect(body.data.token).toMatch(/^[0-9a-f]{64}$/);
  return body.data.token;
};

const openHostAgentSubscription = async (page: Page, cursor: number, key: string): Promise<void> => {
  await page.evaluate(
    ({ startCursor, probeKey }) =>
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/ws/agent`);
        const subscriptionId = `e2e-${probeKey}`;
        const requestId = `subscribe-${probeKey}`;
        const state = { socket, messages: [] as unknown[] };
        const probes = ((
          globalThis as typeof globalThis & { __agentWsProbes?: Record<string, typeof state> }
        ).__agentWsProbes ??= {});
        probes[probeKey] = state;
        const timeout = window.setTimeout(
          () => reject(new Error('Timed out opening Agent WebSocket subscription')),
          10_000,
        );
        socket.addEventListener('open', () => {
          socket.send(
            JSON.stringify({
              type: 'subscribe',
              requestId,
              payload: { subscriptionId, channel: 'host', cursor: startCursor },
            }),
          );
        });
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data)) as { type?: string; requestId?: string };
          state.messages.push(message);
          if (message.type === 'subscribed' && message.requestId === requestId) {
            window.clearTimeout(timeout);
            resolve();
          }
        });
        socket.addEventListener('error', () => {
          window.clearTimeout(timeout);
          reject(new Error('Agent WebSocket failed to open'));
        });
        socket.addEventListener('close', (event) => {
          if (socket.readyState !== WebSocket.OPEN) {
            window.clearTimeout(timeout);
            if (state.messages.length === 0)
              reject(new Error(`Agent WebSocket closed before subscribe: ${event.code}`));
          }
        });
      }),
    { startCursor: cursor, probeKey: key },
  );
};

const waitForDurableAgentSequence = async (page: Page, key: string, after: number): Promise<number> => {
  await page.waitForFunction(
    ({ probeKey, minimum }) => {
      const probes = (
        globalThis as typeof globalThis & {
          __agentWsProbes?: Record<string, { messages: Array<{ type?: string; payload?: unknown }> }>;
        }
      ).__agentWsProbes;
      const messages = probes?.[probeKey]?.messages ?? [];
      return messages.some((message) => {
        if (message.type !== 'event' || !message.payload || typeof message.payload !== 'object') return false;
        const payload = message.payload as { durability?: string; sequence?: number };
        return payload.durability === 'durable' && typeof payload.sequence === 'number' && payload.sequence > minimum;
      });
    },
    { probeKey: key, minimum: after },
  );
  return page.evaluate(
    ({ probeKey, minimum }) => {
      const probes = (
        globalThis as typeof globalThis & {
          __agentWsProbes?: Record<string, { messages: Array<{ type?: string; payload?: unknown }> }>;
        }
      ).__agentWsProbes;
      for (const message of probes?.[probeKey]?.messages ?? []) {
        if (message.type !== 'event' || !message.payload || typeof message.payload !== 'object') continue;
        const payload = message.payload as { durability?: string; sequence?: number };
        if (payload.durability === 'durable' && typeof payload.sequence === 'number' && payload.sequence > minimum) {
          return payload.sequence;
        }
      }
      throw new Error('Durable Agent event not found');
    },
    { probeKey: key, minimum: after },
  );
};

const closeAgentSubscription = async (page: Page, key: string): Promise<void> => {
  await page.evaluate(async (probeKey) => {
    const probes = (
      globalThis as typeof globalThis & {
        __agentWsProbes?: Record<string, { socket: WebSocket }>;
      }
    ).__agentWsProbes;
    const socket = probes?.[probeKey]?.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.addEventListener('close', () => resolve(), { once: true });
      socket.close(1000, 'E2E probe complete');
    });
  }, key);
};

const waitForAgentSubscribed = async (socket: PlaywrightWebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Agent WebSocket subscribed acknowledgement'));
    }, 10_000);
    const onFrame = ({ payload }: { payload: string | Buffer }): void => {
      try {
        const message = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as {
          type?: string;
        };
        if (message.type !== 'subscribed') return;
        cleanup();
        resolve();
      } catch {
        // Ignore unrelated/non-JSON frames; the Agent protocol itself will reject malformed payloads.
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('Agent WebSocket closed before subscribed acknowledgement'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('framereceived', onFrame);
      socket.off('close', onClose);
    };
    socket.on('framereceived', onFrame);
    socket.on('close', onClose);
  });

const setOperationsEnabledFromApi = async (
  request: APIRequestContext,
  enabled: boolean,
  expectedVersion: number,
  csrf: string,
): Promise<AppSummary> => {
  const response = await request.patch('/api/v1/agent/apps/nexus.operations', {
    headers: { 'X-Nexus-CSRF': csrf },
    data: { enabled, expectedVersion },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as AgentEnvelope<AppSummary>).data;
};

const setOperationsEnabledFromPage = async (
  page: Page,
  enabled: boolean,
  expectedVersion: number,
): Promise<AppSummary> =>
  page.evaluate(
    async ({ targetEnabled, version }) => {
      const csrfResponse = await fetch('/api/v1/agent/security/csrf', { credentials: 'same-origin' });
      const csrfText = await csrfResponse.text();
      if (!csrfResponse.ok) throw new Error(csrfText);
      const csrf = JSON.parse(csrfText) as { data: { token: string } };
      const response = await fetch('/api/v1/agent/apps/nexus.operations', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-CSRF': csrf.data.token,
        },
        body: JSON.stringify({ enabled: targetEnabled, expectedVersion: version }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text);
      return (JSON.parse(text) as { data: AppSummary }).data;
    },
    { targetEnabled: enabled, version: expectedVersion },
  );

test('Agent Host reconnects automatically and catches up durable Host events', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);

  let blockAgentReconnects = false;
  let connectedAgentRoute: WebSocketRoute | undefined;
  let agentConnectionAttempts = 0;
  await page.routeWebSocket('**/ws/agent', async (route) => {
    agentConnectionAttempts += 1;
    if (blockAgentReconnects) {
      await route.close({ code: 1012, reason: 'E2E controlled disconnect' });
      return;
    }
    route.connectToServer();
    connectedAgentRoute = route;
  });

  const apps = await context.request.get('/api/v1/agent/apps');
  expect(apps.ok(), await apps.text()).toBeTruthy();
  const appsBody = (await apps.json()) as AgentEnvelope<AppSummary[]>;
  let operations = appsBody.data.find((app) => app.id === 'nexus.operations')!;
  const originalEnabled = operations.enabled;
  const csrf = await csrfToken(context.request);
  if (!operations.enabled) {
    operations = await setOperationsEnabledFromApi(context.request, true, operations.stateVersion, csrf);
  }

  const initialSocketPromise = page.waitForEvent('websocket', {
    predicate: (socket) => new URL(socket.url()).pathname === '/ws/agent',
  });
  await page.goto('/connections');
  const initialSocket = await initialSocketPromise;
  await waitForAgentSubscribed(initialSocket);

  const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
  const hub = page.locator('section[aria-label="Agent"]');
  await launcher.click();
  await expect(hub).toBeVisible();

  try {
    blockAgentReconnects = true;
    expect(connectedAgentRoute).toBeDefined();
    await connectedAgentRoute!.close({ code: 1012, reason: 'E2E controlled disconnect' });
    await expect.poll(() => agentConnectionAttempts, { timeout: 5_000 }).toBeGreaterThan(1);

    operations = await setOperationsEnabledFromApi(context.request, false, operations.stateVersion, csrf);
    await expect(hub).toBeVisible();

    blockAgentReconnects = false;
    await expect(hub).toHaveCount(0, { timeout: 15_000 });
  } finally {
    blockAgentReconnects = false;
    if (operations.enabled !== originalEnabled) {
      operations = await setOperationsEnabledFromApi(context.request, originalEnabled, operations.stateVersion, csrf);
    }
  }
});

test('Agent WebSocket replays durable Host events after a disconnect', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await page.goto('/connections');

  const summary = await context.request.get('/api/v1/agent/summary');
  expect(summary.ok(), await summary.text()).toBeTruthy();
  const summaryBody = (await summary.json()) as AgentEnvelope<{ eventCursor: number }>;
  const initialCursor = summaryBody.data.eventCursor;

  const apps = await context.request.get('/api/v1/agent/apps');
  expect(apps.ok(), await apps.text()).toBeTruthy();
  const appsBody = (await apps.json()) as AgentEnvelope<AppSummary[]>;
  const operations = appsBody.data.find((app) => app.id === 'nexus.operations')!;
  const originalEnabled = operations.enabled;

  await openHostAgentSubscription(page, initialCursor, 'first');
  const toggled = await setOperationsEnabledFromPage(page, !originalEnabled, operations.stateVersion);
  const firstSequence = await waitForDurableAgentSequence(page, 'first', initialCursor);
  await closeAgentSubscription(page, 'first');

  const restored = await setOperationsEnabledFromPage(page, originalEnabled, toggled.stateVersion);
  expect(restored.enabled).toBe(originalEnabled);

  await openHostAgentSubscription(page, firstSequence, 'second');
  const replayedSequence = await waitForDurableAgentSequence(page, 'second', firstSequence);
  expect(replayedSequence).toBeGreaterThan(firstSequence);
  await closeAgentSubscription(page, 'second');

  const retiredSse = await context.request.get('/api/v1/agent/events?cursor=0');
  expect(retiredSse.status()).toBe(404);
});

test('Agent Host initializes Operations safely and persists explicit lifecycle/settings choices', async ({
  request,
}) => {
  await step('Agent APIs use their own authenticated error envelope', async () => {
    const anonymous = await request.get('/api/v1/agent/apps');
    expect(anonymous.status()).toBe(401);
    const body = (await anonymous.json()) as AgentErrorEnvelope;
    expect(body.error.code).toBe('AUTH_REQUIRED');
    expect(body.requestId).toBe(anonymous.headers()['x-request-id']);
  });

  await loginAsInitialAdmin(request);
  const csrf = await csrfToken(request);
  const mutationHeaders = { 'X-Nexus-CSRF': csrf };

  let operations!: AppSummary;

  await step('Operations is registered from the production manifest without requiring a model', async () => {
    const core = await request.get('/api/v1/status');
    expect(core.ok(), await core.text()).toBeTruthy();

    const response = await request.get('/api/v1/agent/apps');
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = (await response.json()) as AgentEnvelope<AppSummary[]>;
    expect(body.requestId).toBe(response.headers()['x-request-id']);
    operations = body.data.find((app) => app.id === 'nexus.operations')!;
    expect(operations).toMatchObject({
      id: 'nexus.operations',
      displayName: 'Operations',
      version: '1.0.0',
      enabled: true,
      health: 'degraded',
      healthReason: 'provider_not_configured',
      runningRuns: 0,
      pendingApprovals: 0,
      pendingBudgetRequests: 0,
    });
    expect(JSON.stringify(body)).not.toContain('factory');
    expect(JSON.stringify(body)).not.toContain('app.manifest.json');
  });

  await step('roadmap-only ACP and Browser capabilities are neither declared nor granted', async () => {
    const response = await request.get('/api/v1/agent/apps/nexus.operations/grants');
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = (await response.json()) as AgentEnvelope<{
      declaredCapabilities: string[];
      grants: Array<{ capability: string }>;
    }>;
    const grantedCapabilities = body.data.grants.map((grant) => grant.capability);
    expect(body.data.declaredCapabilities).toContain('integration.mcp.invoke');
    expect(body.data.declaredCapabilities).not.toContain('integration.acp.execute');
    expect(body.data.declaredCapabilities).not.toContain('browser.operate');
    expect(grantedCapabilities).not.toContain('integration.acp.execute');
    expect(grantedCapabilities).not.toContain('browser.operate');
  });

  await step('Agent mutations reject missing CSRF and stale CAS versions', async () => {
    const missingCsrf = await request.patch('/api/v1/agent/apps/nexus.operations', {
      data: { enabled: false, expectedVersion: operations.stateVersion },
    });
    expect(missingCsrf.status()).toBe(403);
    await expect(missingCsrf.json()).resolves.toMatchObject({ error: { code: 'CSRF_REJECTED' } });

    const disabled = await request.patch('/api/v1/agent/apps/nexus.operations', {
      headers: mutationHeaders,
      data: { enabled: false, expectedVersion: operations.stateVersion },
    });
    expect(disabled.ok(), await disabled.text()).toBeTruthy();
    const disabledBody = (await disabled.json()) as AgentEnvelope<AppSummary>;
    expect(disabledBody.data).toMatchObject({ id: 'nexus.operations', enabled: false, health: 'disabled' });

    const stale = await request.patch('/api/v1/agent/apps/nexus.operations', {
      headers: mutationHeaders,
      data: { enabled: true, expectedVersion: operations.stateVersion },
    });
    expect(stale.status()).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: 'STATE_CONFLICT' } });

    const enabled = await request.patch('/api/v1/agent/apps/nexus.operations', {
      headers: mutationHeaders,
      data: { enabled: true, expectedVersion: disabledBody.data.stateVersion },
    });
    expect(enabled.ok(), await enabled.text()).toBeTruthy();
    const enabledBody = (await enabled.json()) as AgentEnvelope<AppSummary>;
    expect(enabledBody.data).toMatchObject({
      enabled: true,
      health: 'degraded',
      healthReason: 'provider_not_configured',
    });
    operations = enabledBody.data;
  });

  await step('Agent settings patch preserves Hard Limits and feature choice through the host state', async () => {
    const before = await request.get('/api/v1/agent/settings');
    expect(before.ok(), await before.text()).toBeTruthy();
    const beforeBody = (await before.json()) as AgentEnvelope<{
      requestedSettings: { feature: { enabled: boolean }; hardLimits: { maxConcurrentRuntimes: number } };
      effectiveSettings: { feature: { enabled: boolean } };
      hardLimits: { maxConcurrentRuntimes: number };
      availability: { state: string };
      revision: number;
    }>;
    expect(beforeBody.data).toMatchObject({
      requestedSettings: { feature: { enabled: true } },
      effectiveSettings: { feature: { enabled: true } },
      hardLimits: { maxConcurrentRuntimes: 4 },
      availability: { state: 'enabled' },
      revision: 1,
    });

    const directHardLimit = await request.patch('/api/v1/agent/settings', {
      headers: mutationHeaders,
      data: {
        patch: { hardLimits: { maxConcurrentRuntimes: 5 } },
        expectedVersion: beforeBody.data.revision,
      },
    });
    expect(directHardLimit.status()).toBe(400);
    await expect(directHardLimit.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const disabled = await request.patch('/api/v1/agent/settings', {
      headers: mutationHeaders,
      data: { patch: { feature: { enabled: false } }, expectedVersion: beforeBody.data.revision },
    });
    expect(disabled.ok(), await disabled.text()).toBeTruthy();
    const disabledBody = (await disabled.json()) as AgentEnvelope<{
      effectiveSettings: { feature: { enabled: boolean } };
      availability: { state: string };
      revision: number;
    }>;
    expect(disabledBody.data).toMatchObject({
      effectiveSettings: { feature: { enabled: false } },
      availability: { state: 'disabled' },
      revision: 2,
    });

    const reread = await request.get('/api/v1/agent/settings');
    expect(reread.ok(), await reread.text()).toBeTruthy();
    await expect(reread.json()).resolves.toMatchObject({
      data: { effectiveSettings: { feature: { enabled: false } }, revision: 2 },
    });

    const enabled = await request.patch('/api/v1/agent/settings', {
      headers: mutationHeaders,
      data: { patch: { feature: { enabled: true } }, expectedVersion: 2 },
    });
    expect(enabled.ok(), await enabled.text()).toBeTruthy();
    await expect(enabled.json()).resolves.toMatchObject({
      data: { effectiveSettings: { feature: { enabled: true } }, availability: { state: 'enabled' }, revision: 3 },
    });
  });

  await step('Workspace Runtime availability reports the optional Runner as not configured', async () => {
    const response = await request.get('/api/v1/agent/workspace-runtime/availability');
    expect(response.ok(), await response.text()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        available: false,
        state: 'unavailable',
        reason: 'runner_not_configured',
        deploymentId: null,
        controllerVersion: null,
        sandbox: { available: false, reason: 'runner_not_configured' },
        capabilities: { egressAllowlist: false },
      },
    });
  });
});
