import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

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
  const body = (await response.json()) as AgentEnvelope<{ token: string }>;
  expect(body.requestId).toBe(response.headers()['x-request-id']);
  expect(body.data.token).toMatch(/^[0-9a-f]{64}$/);
  return body.data.token;
};

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

  await step('Environment availability reports the optional Runner as not configured', async () => {
    const response = await request.get('/api/v1/agent/environments/availability');
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
