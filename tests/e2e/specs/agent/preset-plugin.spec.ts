import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { slowStep, step } from '../../support/steps';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { addTaskProvider, createTaskThread, sendTask, taskCommand } from '../../fixtures/agent/task-ui';

test.use({ actionTimeout: 10_000 });

type Envelope<T> = { data: T; requestId: string };
type SettingsView = {
  requestedSettings: { plugins: { repositories: Array<{ url: string }> } };
  revision: number;
};
type AppSummary = {
  id: string;
  displayName: string;
  version: string;
  surface: 'builtin' | 'agent' | 'custom' | 'none';
  defaultApprovalMode: 'ask' | 'full_access';
  stateVersion: number;
  policyRevision: number;
  enabled: boolean;
  health: string;
};
type ProviderView = { id: string; version: number };
type PresetScenario = 'browser-lifecycle' | 'core' | 'subagent' | 'surface';
type RunView = {
  id: string;
  status: string;
  version: number;
  goal: { text: string | null; revision: number };
  plan: { revision: number; items: Array<{ id: string; title: string; status: string }> };
  consumedInputSequence: number;
  definition: {
    agentDefinitionId: string;
    model?: { modelId: string };
    approvalMode?: 'ask' | 'full_access';
    connectionIds: number[];
  };
};

const repositoryUrl = `${E2E_URLS.pluginRepositoryOrigin}/catalog.json`;
const repositoryException = `127.0.0.1:${new URL(E2E_URLS.pluginRepositoryOrigin).port}`;

const csrfToken = async (request: APIRequestContext): Promise<string> => {
  const response = await request.get('/api/v1/agent/security/csrf');
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as Envelope<{ token: string }>).data.token;
};

const appSummary = async (request: APIRequestContext, appId: string): Promise<AppSummary> => {
  const response = await request.get('/api/v1/agent/apps');
  expect(response.ok(), await response.text()).toBeTruthy();
  const app = ((await response.json()) as Envelope<AppSummary[]>).data.find((candidate) => candidate.id === appId);
  expect(app).toBeDefined();
  return app!;
};

const openAgentHub = async (page: Page) => {
  const hub = page.locator('section[aria-label="Agent"]');
  const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
  await expect
    .poll(async () => (await hub.isVisible()) || (await launcher.isVisible()), { timeout: 15_000 })
    .toBeTruthy();
  if (!(await hub.isVisible())) {
    try {
      await launcher.click({ timeout: 3_000 });
    } catch (cause) {
      if (!(await hub.isVisible())) throw cause;
    }
  }
  await expect(hub).toBeVisible({ timeout: 10_000 });
  return hub;
};

const waitForTerminalRun = async (request: APIRequestContext, runId: string): Promise<RunView> => {
  const deadline = Date.now() + 30_000;
  let latest: RunView | null = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/v1/apps/nexus.agent/runs/${runId}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    latest = ((await response.json()) as Envelope<RunView>).data;
    if (['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'].includes(latest.status))
      return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Preset Agent Run did not reach a terminal state: ${JSON.stringify(latest)}`);
};

const cancelRunForCleanup = async (request: APIRequestContext, runId: string, page: Page): Promise<RunView> => {
  const terminalStatuses = ['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'];
  const deadline = Date.now() + 10_000;
  let latest: RunView | null = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/v1/apps/nexus.agent/runs/${runId}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    latest = ((await response.json()) as Envelope<RunView>).data;
    if (terminalStatuses.includes(latest.status)) return latest;

    const cancelled = await taskCommand(page, '/stop', `/runs/${runId}/cancel`);
    if (cancelled.ok()) return ((await cancelled.json()) as Envelope<RunView>).data;

    const failure = (await cancelled.json()) as {
      error?: { code?: string; details?: { field?: string } };
    };
    expect(failure.error).toMatchObject({ code: 'STATE_CONFLICT', details: { field: 'expectedVersion' } });
  }
  throw new Error(`Preset Agent Run could not be cancelled with a current version: ${JSON.stringify(latest)}`);
};

const installAndRunNexusAgent = async (
  request: APIRequestContext,
  page: Page,
  scenario: PresetScenario,
): Promise<{ threadId: string; connectionId: number; parallelThreadId: string }> => {
  await loginAsInitialAdmin(request);
  if (request !== page.request) await loginAsInitialAdmin(page.request);
  await setUiLanguage(page.request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };
  const connectionId = await ensureTestSshConnection(request);

  await step('configure the remote repository with the isolated E2E Runner', async () => {
    const before = await request.get('/api/v1/agent/settings');
    expect(before.ok(), await before.text()).toBeTruthy();
    const settings = ((await before.json()) as Envelope<SettingsView>).data;
    const patched = await request.patch('/api/v1/agent/settings', {
      headers,
      data: {
        patch: {
          feature: { enabled: true },
          plugins: { repositories: [{ url: repositoryUrl }] },
        },
        expectedVersion: settings.revision,
      },
    });
    expect(patched.ok(), await patched.text()).toBeTruthy();
    const availability = await request.get('/api/v1/agent/workspace-runtime/availability');
    expect(availability.ok(), await availability.text()).toBeTruthy();
    await expect(availability.json()).resolves.toMatchObject({
      data: { available: true, reason: null, mode: 'native', isolation: 'logical' },
    });
  });

  let publisher!: { keyId: string; label: string; publicKeyPem: string };
  await step('discover the preset through the configured repository and explicitly trust its publisher', async () => {
    const response = await request.get('/api/v1/agent/plugins/remote/catalog', { params: { repositoryUrl } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const catalog = (await response.json()) as Envelope<{
      repositoryUrl: string;
      publishers: Array<{ keyId: string; label: string; publicKeyPem: string }>;
      packages: Array<{
        appId: string;
        version: string;
        sdkVersion: string;
        nexus: { minVersion: string; maxVersion: string };
        compatible: boolean;
        publisherKeyId: string;
        sha256: string;
        sizeBytes: number;
      }>;
    }>;
    expect(catalog.data.repositoryUrl).toBe(repositoryUrl);
    expect(catalog.data.packages).toContainEqual(
      expect.objectContaining({
        appId: 'nexus.agent',
        version: '1.0.0',
        sdkVersion: '1.0.0',
        compatible: true,
      }),
    );
    expect(catalog.data.packages).toContainEqual(
      expect.objectContaining({
        appId: 'nexus.agent',
        version: '1.0.4',
        sdkVersion: '1.0.0',
        nexus: { minVersion: '1.0.4', maxVersion: '1.0.99' },
        compatible: false,
      }),
    );
    publisher = catalog.data.publishers.find(
      (candidate) => candidate.keyId === catalog.data.packages[0]!.publisherKeyId,
    )!;
    expect(publisher).toBeDefined();
    const trusted = await request.post('/api/v1/agent/plugins/publishers', {
      headers,
      data: { publicKeyPem: publisher.publicKeyPem, label: publisher.label },
    });
    expect(trusted.status(), await trusted.text()).toBe(201);
    await expect(trusted.json()).resolves.toMatchObject({ data: { keyId: publisher.keyId } });
  });

  let stageId = '';
  await step('download, hash-check, signature-verify, and install the merged Nexus Agent package', async () => {
    const incompatible = await request.post('/api/v1/agent/plugins/remote/stage', {
      headers,
      data: { repositoryUrl, appId: 'nexus.agent', version: '1.0.4' },
    });
    expect(incompatible.status(), await incompatible.text()).toBe(409);
    await expect(incompatible.json()).resolves.toMatchObject({
      error: { code: 'PLUGIN_REMOTE_PACKAGE_INCOMPATIBLE' },
    });

    const staged = await request.post('/api/v1/agent/plugins/remote/stage', {
      headers,
      data: { repositoryUrl, appId: 'nexus.agent', version: '1.0.0' },
    });
    expect(staged.status(), await staged.text()).toBe(201);
    const stage = (await staged.json()) as Envelope<{
      id: string;
      publisherKeyId: string;
      appId: string;
      version: string;
    }>;
    stageId = stage.data.id;
    expect(stage.data).toMatchObject({ publisherKeyId: publisher.keyId, appId: 'nexus.agent', version: '1.0.0' });

    const verified = await request.post('/api/v1/agent/plugins/verify', { headers, data: { stageId } });
    expect(verified.ok(), await verified.text()).toBeTruthy();
    await expect(verified.json()).resolves.toMatchObject({
      data: {
        plugin: {
          appId: 'nexus.agent',
          version: '1.0.0',
          publisherKeyId: publisher.keyId,
          manifest: { agents: [{ id: 'agent.default', version: '1.0.0' }] },
          skillFiles: ['skills/developer/SKILL.md', 'skills/operations/SKILL.md'],
        },
      },
    });

    const installed = await request.post('/api/v1/agent/plugins/install', { headers, data: { stageId } });
    expect(installed.status(), await installed.text()).toBe(201);
    await expect(installed.json()).resolves.toMatchObject({
      data: {
        plugin: { appId: 'nexus.agent', status: 'installed' },
        app: { surface: 'agent', defaultApprovalMode: 'full_access' },
      },
    });
  });

  await step('grant bounded resource authority, then enable the installed Nexus Agent', async () => {
    const grants = await request.get('/api/v1/agent/apps/nexus.agent/grants');
    expect(grants.ok(), await grants.text()).toBeTruthy();
    const grantView = (await grants.json()) as Envelope<{
      policyRevision: number;
      capabilityDefinitions: Array<{ id: string; scopeKind: 'global' | 'targets'; supportedTargets: string[] }>;
      grants: Array<{ capability: string }>;
    }>;
    expect(grantView.data.capabilityDefinitions.map((definition) => definition.id)).toEqual(
      expect.arrayContaining([
        'file.read',
        'file.write',
        'file.delete',
        'shell.execute',
        'browser.read',
        'browser.interact',
      ]),
    );
    expect(grantView.data.grants).toHaveLength(0);
    const replaced = await request.put('/api/v1/agent/apps/nexus.agent/grants', {
      headers,
      data: {
        grants: [
          {
            capability: 'file.read',
            scope: { kind: 'targets', targets: { ssh: { mode: 'ids', ids: [String(connectionId)] } } },
          },
          { capability: 'machine.inspect', scope: { kind: 'global' } },
          { capability: 'browser.read', scope: { kind: 'global' } },
          {
            capability: 'shell.execute',
            scope: { kind: 'targets', targets: { ssh: { mode: 'ids', ids: [String(connectionId)] } } },
          },
        ],
        expectedPolicyRevision: grantView.data.policyRevision,
      },
    });
    expect(replaced.ok(), await replaced.text()).toBeTruthy();

    const app = await appSummary(request, 'nexus.agent');
    const enabled = await request.patch('/api/v1/agent/apps/nexus.agent', {
      headers,
      data: { enabled: true, expectedVersion: app.stateVersion },
    });
    expect(enabled.ok(), await enabled.text()).toBeTruthy();
    await expect(enabled.json()).resolves.toMatchObject({
      data: { id: 'nexus.agent', enabled: true, health: 'healthy', surface: 'agent' },
    });
  });

  let provider!: ProviderView;
  await step('configure a real model provider and make it the Nexus Agent default', async () => {
    provider = await addTaskProvider(page, 'Preset E2E Provider');
    await addTaskProvider(page, 'Preset alternate Provider', 'e2e-model-alt');
    const current = await request.get('/api/v1/agent/settings');
    const settings = ((await current.json()) as Envelope<SettingsView>).data;
    const patched = await request.patch('/api/v1/agent/settings', {
      headers,
      data: {
        patch: { model: { defaultProviderId: provider.id, defaultModelId: 'e2e-model' } },
        expectedVersion: settings.revision,
      },
    });
    expect(patched.ok(), await patched.text()).toBeTruthy();
  });
  const createTask = (options: { headers: Record<string, string>; data: Parameters<typeof sendTask>[1] }) =>
    scenario === 'subagent' ? request.post('/api/v1/apps/nexus.agent/runs', options) : sendTask(page, options.data);

  if (scenario === 'browser-lifecycle' || scenario === 'subagent') {
    const before = await request.get('/api/v1/agent/settings');
    expect(before.ok()).toBeTruthy();
    const settings = (await before.json()).data;
    const configured = await request.patch('/api/v1/agent/settings', {
      headers,
      data: {
        expectedVersion: settings.revision,
        patch: {
          browser: {
            targets: [
              {
                id: 'e2e-lifecycle',
                endpoints: [
                  {
                    scope: 'external-network',
                    via: 'backend',
                    url: E2E_URLS.browserCdpOrigin,
                    priority: 1,
                    allowPlaintext: true,
                    verifyTls: true,
                  },
                ],
                allowedUrlPatterns: [E2E_URLS.browserControlOrigin],
              },
            ],
          },
        },
      },
    });
    expect(configured.ok(), await configured.text()).toBeTruthy();
  }

  let threadId = '';
  let parallelThreadId = '';
  if (scenario === 'browser-lifecycle') {
    await test.step('a real Browser context is reclaimed after the Agent Run reaches terminal state', async () => {
      const contexts = async () => {
        const response = await fetch(`${E2E_URLS.browserControlOrigin}/contexts`);
        expect(response.ok).toBeTruthy();
        return (await response.json()).browserContextIds as string[];
      };
      const baseline = await contexts();
      const thread = await createTaskThread(page);
      expect(thread.status()).toBe(201);
      const browserThreadId = (await thread.json()).data.id;
      const createBrowserRun = (approval = false, threadId = browserThreadId) =>
        createTask({
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: {
            schemaVersion: 1,
            threadId,
            input: {
              text: `E2E_BROWSER_LIFECYCLE ${randomUUID()}${approval ? ` E2E_BROWSER_APPROVAL=${connectionId}` : ''}`,
              artifactRefs: [],
            },
            agentDefinitionId: 'agent.default',
            model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
            approvalMode: approval ? 'ask' : 'full_access',
            executionMode: 'execute',
            connectionIds: approval ? [connectionId] : [],
          },
        });
      await step('cancellation during Browser initialization retires the late-created context', async () => {
        const armed = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier`, { method: 'POST' });
        expect(armed.ok).toBeTruthy();
        let creatingRunId = '';
        try {
          const creating = await createBrowserRun();
          expect(creating.status()).toBe(201);
          creatingRunId = (await creating.json()).data.id;
          await expect
            .poll(async () => {
              const response = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier`);
              expect(response.ok).toBeTruthy();
              return (await response.json()).held;
            })
            .toBe(true);
          await expect.poll(contexts).toHaveLength(baseline.length + 1);
          await cancelRunForCleanup(request, creatingRunId, page);
        } finally {
          const released = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier/release`, { method: 'POST' });
          expect(released.ok).toBeTruthy();
        }
        if (creatingRunId) {
          expect((await waitForTerminalRun(request, creatingRunId)).status).toBe('cancelled');
          await expect.poll(contexts).toEqual(baseline);
        }
      });
      const created = await createBrowserRun();
      expect(created.status(), await created.text()).toBe(201);
      const run = (await created.json()).data;
      try {
        await expect.poll(contexts).toHaveLength(baseline.length + 1);
        const running = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
        expect(running.ok()).toBeTruthy();
        expect((await running.json()).data.status).toBe('running');
      } finally {
        const released = await fetch(`${E2E_URLS.openAiProviderOrigin}/browser-lifecycle/release`, { method: 'POST' });
        expect(released.ok).toBeTruthy();
      }
      const terminal = await waitForTerminalRun(request, run.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${browserThreadId}/entries?limit=50`);
      expect(ledger.ok()).toBeTruthy();
      expect(JSON.stringify(await ledger.json())).toContain('Browser session created.');
      await expect.poll(contexts).toEqual(baseline);

      await step('cancel an opened Browser Run, reclaim its context, then run again', async () => {
        for (const cancel of [true, false]) {
          const created = await createBrowserRun();
          expect(created.status(), await created.text()).toBe(201);
          const run = (await created.json()).data;
          try {
            await expect.poll(contexts).toHaveLength(baseline.length + 1);
            const live = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
            expect(live.ok()).toBeTruthy();
            expect((await live.json()).data.status).toBe('running');
            if (cancel) {
              await cancelRunForCleanup(request, run.id, page);
              expect((await waitForTerminalRun(request, run.id)).status).toBe('cancelled');
              await expect.poll(contexts).toEqual(baseline);
            }
          } finally {
            const released = await fetch(`${E2E_URLS.openAiProviderOrigin}/browser-lifecycle/release`, {
              method: 'POST',
            });
            expect(released.ok).toBeTruthy();
          }
          const terminal = await waitForTerminalRun(request, run.id);
          if (!cancel) expect(['completed', 'completed_unverified']).toContain(terminal.status);
          const entries = await request.get(`/api/v1/apps/nexus.agent/threads/${browserThreadId}/entries?limit=50`);
          expect(entries.ok()).toBeTruthy();
          const items = (await entries.json()).data.items as Array<{
            runId: string;
            kind: string;
            payload: { text?: string };
          }>;
          expect(
            items
              .filter((entry) => entry.runId === run.id && entry.kind === 'tool_result')
              .some((entry) => {
                const result = JSON.parse(entry.payload.text ?? '{}');
                return result.ok === true && result.summary === 'Browser session created.';
              }),
          ).toBeTruthy();
          await expect.poll(contexts).toEqual(baseline);
        }
      });
      for (const cancelExpandedRun of [false, true])
        await step(
          `automatic budget extension ${cancelExpandedRun ? 'cancellation reclaims' : 'preserves'} the opened context`,
          async () => {
            const settingsResponse = await request.get('/api/v1/agent/settings');
            expect(settingsResponse.ok()).toBeTruthy();
            const original = (await settingsResponse.json()).data;
            const limited = await request.patch('/api/v1/agent/settings', {
              headers,
              data: { expectedVersion: original.revision, patch: { budget: { maxModelRequests: 2 } } },
            });
            expect(limited.ok(), await limited.text()).toBeTruthy();
            let budgetRunId = '';
            try {
              const isolatedThread = await createTaskThread(page);
              expect(isolatedThread.status()).toBe(201);
              const created = await createBrowserRun(false, (await isolatedThread.json()).data.id);
              expect(created.status(), await created.text()).toBe(201);
              budgetRunId = (await created.json()).data.id;
              const readRun = async () => {
                const response = await request.get(`/api/v1/apps/nexus.agent/runs/${budgetRunId}`);
                expect(response.ok()).toBeTruthy();
                return (await response.json()).data;
              };
              await expect.poll(async () => (await readRun()).budget.extensionCount).toBeGreaterThan(0);
              const waiting = await readRun();
              const liveContexts = await contexts();
              expect(liveContexts).toHaveLength(baseline.length + 1);
              expect(waiting.status).toBe('running');
              expect(waiting.budget.maxModelRequests).toBeGreaterThan(2);
              expect(waiting.budget.maxModelRequests).toBeLessThanOrEqual(waiting.budget.modelRequestCeiling);
              if (cancelExpandedRun) {
                await cancelRunForCleanup(request, budgetRunId, page);
                expect((await waitForTerminalRun(request, budgetRunId)).status).toBe('cancelled');
                await expect.poll(contexts).toEqual(baseline);
                const late = await request.post(`/api/v1/apps/nexus.agent/runs/${budgetRunId}/budget`, {
                  headers: { ...headers, 'Idempotency-Key': randomUUID() },
                  data: { schemaVersion: 1, expectedVersion: waiting.version, increase: { maxSubagentMessages: 100 } },
                });
                expect(late.status()).toBe(409);
                const cancelled = await readRun();
                const currentVersionIncrease = await request.post(
                  `/api/v1/apps/nexus.agent/runs/${budgetRunId}/budget`,
                  {
                    headers: { ...headers, 'Idempotency-Key': randomUUID() },
                    data: {
                      schemaVersion: 1,
                      expectedVersion: cancelled.version,
                      increase: { maxSubagentMessages: 100 },
                    },
                  },
                );
                expect(currentVersionIncrease.status()).toBe(409);
                expect((await readRun()).status).toBe('cancelled');
                expect(await contexts()).toEqual(baseline);
                return;
              }
              expect(await contexts()).toEqual(liveContexts);
              const released = await fetch(`${E2E_URLS.openAiProviderOrigin}/browser-lifecycle/release`, {
                method: 'POST',
              });
              expect(released.ok).toBeTruthy();
              const terminal = await waitForTerminalRun(request, budgetRunId);
              expect(['completed', 'completed_unverified']).toContain(terminal.status);
              await expect.poll(contexts).toEqual(baseline);
            } finally {
              if (budgetRunId) {
                await cancelRunForCleanup(request, budgetRunId, page);
                await waitForTerminalRun(request, budgetRunId);
              }
              const currentResponse = await request.get('/api/v1/agent/settings');
              expect(currentResponse.ok()).toBeTruthy();
              const current = (await currentResponse.json()).data;
              const restored = await request.patch('/api/v1/agent/settings', {
                headers,
                data: {
                  expectedVersion: current.revision,
                  patch: { budget: { maxModelRequests: original.effectiveSettings.budget.maxModelRequests } },
                },
              });
              expect(restored.ok(), await restored.text()).toBeTruthy();
            }
          },
        );
      for (const decision of ['denied', 'approved', 'cancelled'] as const)
        await step(`approval waiting preserves the opened context until ${decision} resumes the Run`, async () => {
          const created = await createBrowserRun(true);
          expect(created.status(), await created.text()).toBe(201);
          const run = (await created.json()).data;
          try {
            const readRun = async () => {
              const response = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
              expect(response.ok()).toBeTruthy();
              return (await response.json()).data;
            };
            await expect.poll(async () => (await readRun()).status).toBe('awaiting_approval');
            const liveContexts = await contexts();
            expect(liveContexts).toHaveLength(baseline.length + 1);
            const approvals = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}/approvals`);
            expect(approvals.ok()).toBeTruthy();
            const pending = (await approvals.json()).data.filter(
              (approval: { status: string }) => approval.status === 'requested',
            );
            expect(pending).toHaveLength(1);
            const approval = pending[0];
            expect(approval.inspection.toolName).toBe('shell_execute');
            if (decision === 'cancelled') {
              await cancelRunForCleanup(request, run.id, page);
              expect((await waitForTerminalRun(request, run.id)).status).toBe('cancelled');
              await expect.poll(contexts).toEqual(baseline);
              const late = await request.post(`/api/v1/apps/nexus.agent/approvals/${approval.id}/resolve`, {
                headers: { ...headers, 'Idempotency-Key': randomUUID() },
                data: {
                  schemaVersion: 1,
                  expectedVersion: approval.version,
                  operationHash: approval.operationHash,
                  decision: 'approved',
                },
              });
              expect(late.status()).toBe(409);
              const refreshed = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}/approvals`);
              expect(refreshed.ok()).toBeTruthy();
              const refreshedApprovals = (await refreshed.json()).data;
              expect(refreshedApprovals).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: approval.id, status: 'superseded' })]),
              );
              const superseded = refreshedApprovals.find((item: { id: string }) => item.id === approval.id);
              const currentVersionApproval = await request.post(
                `/api/v1/apps/nexus.agent/approvals/${approval.id}/resolve`,
                {
                  headers: { ...headers, 'Idempotency-Key': randomUUID() },
                  data: {
                    schemaVersion: 1,
                    expectedVersion: superseded.version,
                    operationHash: superseded.operationHash,
                    decision: 'approved',
                  },
                },
              );
              expect(currentVersionApproval.status()).toBe(409);
              expect((await readRun()).status).toBe('cancelled');
              expect(await contexts()).toEqual(baseline);
              return;
            }
            const denied = await request.post(`/api/v1/apps/nexus.agent/approvals/${approval.id}/resolve`, {
              headers: { ...headers, 'Idempotency-Key': randomUUID() },
              data: {
                schemaVersion: 1,
                expectedVersion: approval.version,
                operationHash: approval.operationHash,
                decision,
              },
            });
            expect(denied.ok(), await denied.text()).toBeTruthy();
            expect((await denied.json()).data.status).toBe(decision);
            await expect.poll(async () => (await readRun()).status).toBe('running');
            expect(await contexts()).toEqual(liveContexts);
            const released = await fetch(`${E2E_URLS.openAiProviderOrigin}/browser-lifecycle/release`, {
              method: 'POST',
            });
            expect(released.ok).toBeTruthy();
            const terminal = await waitForTerminalRun(request, run.id);
            expect(['completed', 'completed_unverified']).toContain(terminal.status);
            const entries = await request.get(`/api/v1/apps/nexus.agent/threads/${browserThreadId}/entries?limit=50`);
            expect(entries.ok()).toBeTruthy();
            const items = (await entries.json()).data.items as Array<{
              runId: string;
              kind: string;
              payload: { text?: string };
            }>;
            const results = items
              .filter((entry) => entry.runId === run.id && entry.kind === 'tool_result')
              .map((entry) => JSON.parse(entry.payload.text ?? '{}'));
            expect(results).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ ok: true, summary: 'Browser session created.' }),
                decision === 'denied'
                  ? expect.objectContaining({ ok: false, errorCode: 'APPROVAL_DENIED' })
                  : expect.objectContaining({ ok: true }),
              ]),
            );
            if (decision === 'approved') {
              const executed = results.find((result) => result.summary !== 'Browser session created.' && result.ok);
              expect(executed).toBeTruthy();
              expect(JSON.stringify(executed)).toContain('browser-approval-e2e');
            }
            await expect.poll(contexts).toEqual(baseline);
          } finally {
            await cancelRunForCleanup(request, run.id, page);
            await waitForTerminalRun(request, run.id);
          }
        });
    });
    return { threadId, connectionId, parallelThreadId };
  }
  if (scenario === 'core' || scenario === 'surface')
    await step('the plugin AgentDefinition is visible and completes a real Run', async () => {
      const definitions = await request.get('/api/v1/apps/nexus.agent/agent-definitions');
      expect(definitions.ok(), await definitions.text()).toBeTruthy();
      await expect(definitions.json()).resolves.toMatchObject({
        data: [{ id: 'agent.default', version: '1.0.0', displayName: 'Nexus Agent' }],
      });

      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      threadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId,
          input: {
            text: 'E2E_GOAL_UPDATE_HOLD E2E_EXPECT_DEVELOPER_SKILL E2E_NO_WORKSPACE_TOOLS Implement and test a small code change, then confirm the Nexus Agent is running.',
            artifactRefs: [],
          },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const run = ((await created.json()) as Envelope<RunView>).data;
      expect(run.definition.agentDefinitionId).toBe('agent.default');

      const runningDeadline = Date.now() + 10_000;
      let running = run;
      while (running.status !== 'running' && Date.now() < runningDeadline) {
        const response = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
        expect(response.ok(), await response.text()).toBeTruthy();
        running = ((await response.json()) as Envelope<RunView>).data;
        if (running.status !== 'running') await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(running.status).toBe('running');

      const durableGoal = 'Confirm the Nexus Agent Developer Skill goal remains durable.';
      const goalUpdated = await taskCommand(page, `/goal ${durableGoal}`, `/runs/${run.id}/goal`);
      expect(goalUpdated.ok()).toBe(true);
      expect((await goalUpdated.json()).data.goal).toMatchObject({ text: durableGoal, revision: 1 });

      const terminal = await waitForTerminalRun(request, run.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      expect(terminal.goal).toMatchObject({ text: durableGoal, revision: 1 });
      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${threadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      expect(JSON.stringify(await ledger.json())).toContain('OK');
    });

  if (scenario === 'core')
    await step('the merged App exposes Operations separately through metadata-first Skill loading', async () => {
      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const operationsThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: operationsThreadId,
          input: {
            text: 'E2E_EXPECT_OPERATIONS_SKILL Diagnose service health and bounded logs for an incident.',
            artifactRefs: [],
          },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const terminal = await waitForTerminalRun(request, ((await created.json()) as Envelope<RunView>).data.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${operationsThreadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      const serialized = JSON.stringify(await ledger.json());
      expect(serialized).toContain('skill_read');
      expect(serialized).toContain('nexus.agent.operations');
    });

  if (scenario === 'core')
    await step('control-risk tools persist the current enum without compatibility remapping', async () => {
      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const controlThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: controlThreadId,
          input: { text: 'E2E_CONTROL_TOOL_RISK Persist the current control risk enum directly.', artifactRefs: [] },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const terminal = await waitForTerminalRun(request, ((await created.json()) as Envelope<RunView>).data.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      expect(terminal.plan.items).toContainEqual(
        expect.objectContaining({ id: 'control-enum-e2e', status: 'completed' }),
      );
      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${controlThreadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      expect(JSON.stringify(await ledger.json())).toContain('plan_update');
    });

  if (scenario === 'core')
    await step('one model turn persists and completes every tool call before the next inference', async () => {
      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const batchThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: batchThreadId,
          input: {
            text: 'E2E_MULTI_TOOL_BATCH Execute both tool calls from the same assistant turn before sampling again.',
            artifactRefs: [],
          },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const terminal = await waitForTerminalRun(request, ((await created.json()) as Envelope<RunView>).data.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);

      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${batchThreadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      const serialized = JSON.stringify(await ledger.json());
      expect(serialized).toContain('call_e2e_batch_first');
      expect(serialized).toContain('call_e2e_batch_second');
      expect(serialized).not.toContain('E2E_BATCH_PROTOCOL_INVALID');
      expect(serialized).toContain('OK');
    });

  if (scenario === 'core' || scenario === 'surface')
    await step('parallel-safe read tools from one model turn settle as one complete batch', async () => {
      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const batchThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      parallelThreadId = batchThreadId;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: batchThreadId,
          input: {
            text: `E2E_MULTI_TOOL_CONNECTION_ID=${connectionId} Execute both parallel-safe read calls from the same assistant turn before sampling again.`,
            artifactRefs: [],
          },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [connectionId],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const terminal = await waitForTerminalRun(request, ((await created.json()) as Envelope<RunView>).data.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);

      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${batchThreadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      const serialized = JSON.stringify(await ledger.json());
      expect(serialized).toContain('call_e2e_multi_list');
      expect(serialized).toContain('call_e2e_multi_read');
      expect(serialized).toContain('machine_connection_list');
      expect(serialized).toContain('file_read');
      expect(serialized).toContain('nexus-e2e-seed');
    });

  if (scenario === 'subagent')
    await test.step('subagent history preserves one assistant turn with every tool call and result', async () => {
      const cancelSubagentRunForCleanup = async (runId: string): Promise<RunView> => {
        const terminalStatuses = ['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'];
        const deadline = Date.now() + 10_000;
        let latest: RunView | null = null;
        while (Date.now() < deadline) {
          const response = await request.get(`/api/v1/apps/nexus.agent/runs/${runId}`);
          expect(response.ok(), await response.text()).toBeTruthy();
          latest = ((await response.json()) as Envelope<RunView>).data;
          if (terminalStatuses.includes(latest.status)) return latest;
          const cancelled = await request.post(`/api/v1/apps/nexus.agent/runs/${runId}/cancel`, {
            headers: { ...headers, 'Idempotency-Key': randomUUID() },
            data: { schemaVersion: 1, expectedVersion: latest.version },
          });
          if (cancelled.ok()) return ((await cancelled.json()) as Envelope<RunView>).data;
          const failure = (await cancelled.json()) as { error?: { code?: string } };
          expect(failure.error?.code).toBe('STATE_CONFLICT');
        }
        throw new Error(`Preset Agent Run could not be cancelled with a current version: ${JSON.stringify(latest)}`);
      };

      const settingsResponse = await request.get('/api/v1/apps/nexus.agent/subagent-settings');
      expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
      const subagentSettings = (
        (await settingsResponse.json()) as Envelope<{
          version: number;
          policy: { profiles: unknown[] };
        }>
      ).data;
      const configured = await request.patch('/api/v1/apps/nexus.agent/subagent-settings', {
        headers,
        data: {
          expectedVersion: subagentSettings.version,
          profiles: [
            {
              id: 'e2e-worker',
              role: 'Deterministic E2E child agent',
              defaultModel: {
                providerId: provider.id,
                modelId: 'e2e-model',
                configurationVersion: provider.version,
              },
              allowedModels: [
                {
                  providerId: provider.id,
                  modelId: 'e2e-model',
                  configurationVersion: provider.version,
                },
              ],
              capabilities: ['browser.read'],
              peerMessaging: 'parent-child',
              mutationMode: 'read-only',
              maxModelRequests: 8,
              failureMode: 'isolate',
            },
          ],
        },
      });
      expect(configured.ok(), await configured.text()).toBeTruthy();

      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const threadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId,
          input: {
            text: 'E2E_SUBAGENT_MULTI_TOOL_BATCH Delegate the deterministic child and wait for its bounded result.',
            artifactRefs: [],
          },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const run = ((await created.json()) as Envelope<RunView>).data;
      const terminal = await waitForTerminalRun(request, run.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);

      const subagents = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}/subagents?limit=20`);
      expect(subagents.ok(), await subagents.text()).toBeTruthy();
      const subagentPayload = JSON.stringify(await subagents.json());
      expect(subagentPayload).toContain('e2e-worker');
      expect(subagentPayload).toContain('CHILD_BATCH_OK');
      expect(subagentPayload).not.toContain('E2E_CHILD_BATCH_PROTOCOL_INVALID');

      for (const phase of [
        'complete',
        'cancel-live',
        'cancel-creating',
        'child-cancel-live',
        'child-cancel-creating',
      ] as const)
        await step(`a real Child Browser context is reclaimed: ${phase}`, async () => {
          const independent = phase.startsWith('child-');
          const cancel = phase !== 'complete' && !independent;
          const cancelCreating = phase.endsWith('creating');
          const contexts = async () => {
            const response = await fetch(`${E2E_URLS.browserControlOrigin}/contexts`);
            expect(response.ok).toBeTruthy();
            return (await response.json()).browserContextIds as string[];
          };
          const baseline = await contexts();
          const thread = await createTaskThread(page);
          expect(thread.status()).toBe(201);
          const childThreadId = (await thread.json()).data.id;
          if (cancelCreating) {
            const armed = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier`, { method: 'POST' });
            expect(armed.ok).toBeTruthy();
          }
          const created = await createTask({
            headers: { ...headers, 'Idempotency-Key': randomUUID() },
            data: {
              schemaVersion: 1,
              threadId: childThreadId,
              input: {
                text: `E2E_SUBAGENT_MULTI_TOOL_BATCH E2E_CHILD_BROWSER_REQUEST${independent ? ' E2E_CHILD_INDEPENDENT_CANCEL' : ''}`,
                artifactRefs: [],
              },
              agentDefinitionId: 'agent.default',
              model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
              approvalMode: 'ask',
              executionMode: 'execute',
              connectionIds: [],
            },
          });
          expect(created.status(), await created.text()).toBe(201);
          const run = (await created.json()).data;
          try {
            if (cancelCreating) {
              await expect
                .poll(async () => {
                  const response = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier`);
                  expect(response.ok).toBeTruthy();
                  return (await response.json()).held;
                })
                .toBe(true);
            }
            await expect.poll(contexts).toHaveLength(baseline.length + 1);
            if (independent) {
              if (!cancelCreating) {
                // Context allocation precedes tool settlement and the next model claim,
                // both of which can advance the delegation's optimistic version.
                await expect
                  .poll(async () => {
                    const response = await fetch(`${E2E_URLS.openAiProviderOrigin}/browser-lifecycle`);
                    expect(response.ok).toBeTruthy();
                    return (await response.json()).held;
                  })
                  .toBe(true);
              }
              const children = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}/subagents?limit=20`);
              expect(children.ok()).toBeTruthy();
              const items = (await children.json()).data.items;
              expect(items).toHaveLength(1);
              const child = items[0];
              expect(child.status).toBe('running');
              expect(child.version).toBeGreaterThan(1);
              const stale = await request.post(`/api/v1/apps/nexus.agent/runs/${run.id}/subagents/${child.id}/cancel`, {
                headers,
                data: { expectedVersion: child.version - 1 },
              });
              expect(stale.status(), await stale.text()).toBe(409);
              expect((await stale.json()).error.code).toBe('DELEGATION_VERSION_CONFLICT');
              const cancelled = await request.post(
                `/api/v1/apps/nexus.agent/runs/${run.id}/subagents/${child.id}/cancel`,
                {
                  headers,
                  data: { expectedVersion: child.version },
                },
              );
              expect(cancelled.status(), await cancelled.text()).toBe(202);
              expect((await cancelled.json()).data.status).toBe('cancelled');
              if (cancelCreating) {
                const released = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier/release`, {
                  method: 'POST',
                });
                expect(released.ok).toBeTruthy();
              }
              await expect
                .poll(async () => {
                  const response = await fetch(`${E2E_URLS.openAiProviderOrigin}/child-cancel-parent`);
                  expect(response.ok).toBeTruthy();
                  return (await response.json()).held;
                })
                .toBe(true);
              const parent = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
              expect(parent.ok()).toBeTruthy();
              expect((await parent.json()).data.status).toBe('running');
            }
            if (cancel) {
              await cancelSubagentRunForCleanup(run.id);
              if (cancelCreating) {
                const released = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier/release`, {
                  method: 'POST',
                });
                expect(released.ok).toBeTruthy();
              }
              await expect
                .poll(async () => {
                  const status = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
                  const children = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}/subagents?limit=20`);
                  expect(status.ok()).toBeTruthy();
                  expect(children.ok()).toBeTruthy();
                  return {
                    run: (await status.json()).data.status,
                    children: (await children.json()).data.items.map((child: { status: string }) => child.status),
                  };
                })
                .toEqual({ run: 'cancelled', children: ['cancelled'] });
              await expect.poll(contexts).toEqual(baseline);
            }
          } finally {
            if (independent) {
              const released = await fetch(`${E2E_URLS.openAiProviderOrigin}/child-cancel-parent`, { method: 'POST' });
              expect(released.ok).toBeTruthy();
            }
            if (cancelCreating) {
              const released = await fetch(`${E2E_URLS.browserControlOrigin}/creation-barrier/release`, {
                method: 'POST',
              });
              expect(released.ok).toBeTruthy();
            }
            const released = await fetch(`${E2E_URLS.openAiProviderOrigin}/browser-lifecycle/release`, {
              method: 'POST',
            });
            expect(released.ok).toBeTruthy();
          }
          try {
            const terminal = await waitForTerminalRun(request, run.id);
            if (cancel) expect(terminal.status).toBe('cancelled');
            else expect(['completed', 'completed_unverified']).toContain(terminal.status);
            const children = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}/subagents?limit=20`);
            expect(children.ok()).toBeTruthy();
            const childItems = (await children.json()).data.items;
            expect(childItems).toHaveLength(1);
            const child = childItems[0];
            expect(child.status).toBe(cancel || independent ? 'cancelled' : 'completed');
            expect(child.childRuntimeId).not.toBe(child.parentRuntimeId);
            const serialized = JSON.stringify(child.result);
            if (!cancel && !independent) {
              expect(serialized).toContain('Browser lifecycle fixture completed.');
              expect(serialized).toContain(child.childRuntimeId);
              expect(serialized).toContain(run.id);
              expect(serialized).toContain('Browser session created.');
            }
            await expect.poll(contexts).toEqual(baseline);
          } finally {
            await cancelSubagentRunForCleanup(run.id);
            await waitForTerminalRun(request, run.id);
          }
        });
    });

  if (scenario === 'core')
    await step('file_read reads a selected SSH target through the bounded SFTP capability', async () => {
      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const readThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: readThreadId,
          input: {
            text: `E2E_READ_FILE_CONNECTION_ID=${connectionId} Read the bounded remote seed fixture.`,
            artifactRefs: [],
          },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [connectionId],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const terminal = await waitForTerminalRun(request, ((await created.json()) as Envelope<RunView>).data.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${readThreadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      const serialized = JSON.stringify(await ledger.json());
      expect(serialized).toContain('file_read');
      expect(serialized).toContain('nexus-e2e-seed');
    });

  if (scenario === 'core')
    await step('distinct tool calls execute identical commands as separate intentional operations', async () => {
      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const duplicateThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: duplicateThreadId,
          input: {
            text: `E2E_DUPLICATE_MUTATION_CONNECTION_ID=${connectionId} Execute the bounded mutation twice with distinct tool call identities.`,
            artifactRefs: [],
          },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'full_access',
          executionMode: 'execute',
          connectionIds: [connectionId],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const run = ((await created.json()) as Envelope<RunView>).data;
      const terminal = await waitForTerminalRun(request, run.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);

      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${duplicateThreadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      const serialized = JSON.stringify(await ledger.json());
      expect(serialized).not.toContain('MUTATION_ALREADY_CONFIRMED');
      expect(serialized).toContain('duplicate-e2e');
    });

  if (scenario === 'core')
    await step('strict interrupt supersedes only a streaming model and drains the durable input queue', async () => {
      const thread = await createTaskThread(page);
      expect(thread.status(), await thread.text()).toBe(201);
      const interruptThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
      const created = await createTask({
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: interruptThreadId,
          input: { text: 'E2E_INTERRUPT_HOLD Confirm strict interrupt rescheduling.', artifactRefs: [] },
          agentDefinitionId: 'agent.default',
          model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const run = ((await created.json()) as Envelope<RunView>).data;

      const runningDeadline = Date.now() + 10_000;
      let running = run;
      while (running.status !== 'running' && Date.now() < runningDeadline) {
        const response = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
        expect(response.ok(), await response.text()).toBeTruthy();
        running = ((await response.json()) as Envelope<RunView>).data;
        if (running.status !== 'running') await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(running.status).toBe('running');

      const interrupted = await taskCommand(
        page,
        '/interrupt E2E_INTERRUPT_RESUME Continue from the new user input.',
        `/runs/${run.id}/interrupt`,
      );
      expect(interrupted.status(), await interrupted.text()).toBe(202);

      const terminal = await waitForTerminalRun(request, run.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      const pending = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}/pending-inputs`);
      expect(pending.ok(), await pending.text()).toBeTruthy();
      await expect(pending.json()).resolves.toMatchObject({ data: { items: [], total: 0, hasMore: false } });

      const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${interruptThreadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      expect(JSON.stringify(await ledger.json())).toContain('E2E_INTERRUPT_RESUME');
    });

  return { threadId, connectionId, parallelThreadId };
};

test('unsafe remote plugin archive fails validation without terminating the Backend', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };
  const before = await request.get('/api/v1/agent/settings');
  expect(before.ok(), await before.text()).toBeTruthy();
  const settings = ((await before.json()) as Envelope<SettingsView>).data;
  const patched = await request.patch('/api/v1/agent/settings', {
    headers,
    data: {
      patch: { plugins: { repositories: [{ url: repositoryUrl }] } },
      expectedVersion: settings.revision,
    },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  const staged = await request.post('/api/v1/agent/plugins/remote/stage', {
    headers,
    data: { repositoryUrl, appId: 'nexus.unsafe', version: '1.0.0' },
  });
  expect(staged.status(), await staged.text()).toBe(201);
  const stageId = ((await staged.json()) as Envelope<{ id: string }>).data.id;
  const verified = await request.post('/api/v1/agent/plugins/verify', { headers, data: { stageId } });
  expect(verified.status(), await verified.text()).toBe(422);
  await expect(verified.json()).resolves.toMatchObject({ error: { code: 'PLUGIN_ARCHIVE_UNSAFE' } });

  const health = await request.get('/api/v1/agent/apps');
  expect(health.ok(), await health.text()).toBeTruthy();
});

test('official first-party catalog is discoverable without repository configuration and stages through the pinned source', async ({
  page,
  context,
}) => {
  const request = context.request;
  await loginAsInitialAdmin(request);
  await setUiLanguage(request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };

  const settingsResponse = await request.get('/api/v1/agent/settings');
  expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
  const settings = ((await settingsResponse.json()) as Envelope<SettingsView>).data;
  expect(settings.requestedSettings.plugins.repositories).toEqual([]);

  const catalogResponse = await request.get('/api/v1/agent/plugins/official/catalog');
  expect(catalogResponse.ok(), await catalogResponse.text()).toBeTruthy();
  const catalog = (await catalogResponse.json()) as Envelope<{
    publishers: Array<{ keyId: string }>;
    packages: Array<{ appId: string; version: string; publisherKeyId: string; compatible: boolean }>;
  }>;
  expect(new Set(catalog.data.packages.map((candidate) => candidate.appId))).toEqual(
    new Set(['nexus.agent', 'nexus.fullstack']),
  );
  expect(catalog.data.packages).toContainEqual(
    expect.objectContaining({ appId: 'nexus.agent', version: '1.0.0', compatible: true }),
  );
  expect(catalog.data.packages).toContainEqual(
    expect.objectContaining({ appId: 'nexus.agent', version: '1.0.4', compatible: false }),
  );
  expect(catalog.data.packages.some((candidate) => candidate.appId === 'nexus.custom-surface')).toBe(false);
  expect(catalog.data.packages.some((candidate) => candidate.appId === 'nexus.unsafe')).toBe(false);
  const fullstack = catalog.data.packages.find((candidate) => candidate.appId === 'nexus.fullstack');
  expect(fullstack).toMatchObject({ version: '1.0.0' });
  expect(catalog.data.publishers.some((publisher) => publisher.keyId === fullstack!.publisherKeyId)).toBe(true);

  const staged = await request.post('/api/v1/agent/plugins/official/stage', {
    headers,
    data: { appId: 'nexus.fullstack', version: '1.0.0' },
  });
  expect(staged.status(), await staged.text()).toBe(201);
  const stageId = ((await staged.json()) as Envelope<{ id: string }>).data.id;
  const verified = await request.post('/api/v1/agent/plugins/verify', { headers, data: { stageId } });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  await expect(verified.json()).resolves.toMatchObject({
    data: {
      plugin: {
        appId: 'nexus.fullstack',
        frontendEntry: 'frontend/index.html',
        backendEntry: 'backend/index.mjs',
      },
    },
  });

  await page.goto('/settings?tab=agent');
  const panel = page.locator('#settings-panel-agent');
  await panel
    .getByRole('navigation', { name: 'Agent settings sections', exact: true })
    .getByRole('button', { name: 'Apps and extensions', exact: true })
    .click();
  const pluginsHeading = panel.getByRole('heading', { name: 'Installable apps and skills', exact: true });
  await pluginsHeading.scrollIntoViewIfNeeded();
  const pluginsSection = pluginsHeading.locator('xpath=ancestor::section[1]');
  await expect(pluginsSection.getByText('Official repository', { exact: true })).toBeVisible();
  const agentCatalogIds = pluginsSection.getByText('nexus.agent', { exact: true });
  await expect(agentCatalogIds).toHaveCount(2);
  await expect(agentCatalogIds.first()).toBeVisible();
  await expect(agentCatalogIds.nth(1)).toBeVisible();
  await expect(pluginsSection.getByText('nexus.fullstack', { exact: true }).first()).toBeVisible();
});

test('uninstalled plugin retained AppStorage can be permanently deleted', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };

  const settingsResponse = await request.get('/api/v1/agent/settings');
  expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
  const settings = ((await settingsResponse.json()) as Envelope<SettingsView>).data;
  const patched = await request.patch('/api/v1/agent/settings', {
    headers,
    data: {
      patch: {
        feature: { enabled: true },
        plugins: { repositories: [{ url: repositoryUrl }] },
      },
      expectedVersion: settings.revision,
    },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  const catalogResponse = await request.get('/api/v1/agent/plugins/remote/catalog', { params: { repositoryUrl } });
  expect(catalogResponse.ok(), await catalogResponse.text()).toBeTruthy();
  const catalog = (await catalogResponse.json()) as Envelope<{
    publishers: Array<{ keyId: string; label: string; publicKeyPem: string }>;
    packages: Array<{ appId: string; version: string; publisherKeyId: string }>;
  }>;
  const packageEntry = catalog.data.packages.find((candidate) => candidate.appId === 'nexus.custom-surface');
  expect(packageEntry).toMatchObject({ version: '1.0.0' });
  const publisher = catalog.data.publishers.find((candidate) => candidate.keyId === packageEntry!.publisherKeyId);
  expect(publisher).toBeDefined();
  const trusted = await request.post('/api/v1/agent/plugins/publishers', {
    headers,
    data: { publicKeyPem: publisher!.publicKeyPem, label: publisher!.label },
  });
  expect(trusted.status(), await trusted.text()).toBe(201);

  const staged = await request.post('/api/v1/agent/plugins/remote/stage', {
    headers,
    data: { repositoryUrl, appId: 'nexus.custom-surface', version: '1.0.0' },
  });
  expect(staged.status(), await staged.text()).toBe(201);
  const stageId = ((await staged.json()) as Envelope<{ id: string }>).data.id;
  const verified = await request.post('/api/v1/agent/plugins/verify', { headers, data: { stageId } });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const installed = await request.post('/api/v1/agent/plugins/install', { headers, data: { stageId } });
  expect(installed.status(), await installed.text()).toBe(201);

  let app = await appSummary(request, 'nexus.custom-surface');
  const enabled = await request.patch('/api/v1/agent/apps/nexus.custom-surface', {
    headers,
    data: { enabled: true, expectedVersion: app.stateVersion },
  });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();
  app = ((await enabled.json()) as Envelope<AppSummary>).data;
  expect(app).toMatchObject({ enabled: true, health: 'healthy' });

  const stored = await request.post('/api/v1/agent/plugins/nexus.custom-surface/frontend/rpc', {
    headers,
    data: {
      version: '1.0.0',
      method: 'storage.put',
      operationId: crypto.randomUUID(),
      params: { key: 'e2e.retained', value: { retained: true }, expectedVersion: null },
    },
  });
  expect(stored.ok(), await stored.text()).toBeTruthy();

  const disabled = await request.patch('/api/v1/agent/apps/nexus.custom-surface', {
    headers,
    data: { enabled: false, expectedVersion: app.stateVersion },
  });
  expect(disabled.ok(), await disabled.text()).toBeTruthy();
  app = ((await disabled.json()) as Envelope<AppSummary>).data;

  const uninstalled = await request.post('/api/v1/agent/plugins/nexus.custom-surface/uninstall', {
    headers,
    data: { deleteData: false, expectedVersion: app.stateVersion },
  });
  expect(uninstalled.ok(), await uninstalled.text()).toBeTruthy();
  await expect(uninstalled.json()).resolves.toMatchObject({ data: { state: 'removed' } });

  const beforeDelete = await request.get('/api/v1/agent/plugins/installations');
  expect(beforeDelete.ok(), await beforeDelete.text()).toBeTruthy();
  const removed = (
    (await beforeDelete.json()) as Envelope<
      Array<{ appId: string; status: string; retainedDataEntries: number; retainedDataBytes: number }>
    >
  ).data.find((candidate) => candidate.appId === 'nexus.custom-surface');
  expect(removed).toMatchObject({ appId: 'nexus.custom-surface', status: 'removed' });
  expect(removed!.retainedDataEntries).toBeGreaterThan(0);
  expect(removed!.retainedDataBytes).toBeGreaterThan(0);

  const deleted = await request.post('/api/v1/agent/plugins/nexus.custom-surface/delete-data', {
    headers,
    data: { confirmed: true },
  });
  expect(deleted.ok(), await deleted.text()).toBeTruthy();
  await expect(deleted.json()).resolves.toMatchObject({ data: { deleted: true } });

  const afterDelete = await request.get('/api/v1/agent/plugins/installations');
  expect(afterDelete.ok(), await afterDelete.text()).toBeTruthy();
  const cleared = (
    (await afterDelete.json()) as Envelope<
      Array<{ appId: string; status: string; retainedDataEntries: number; retainedDataBytes: number }>
    >
  ).data.find((candidate) => candidate.appId === 'nexus.custom-surface');
  expect(cleared).toMatchObject({
    appId: 'nexus.custom-surface',
    status: 'removed',
    retainedDataEntries: 0,
    retainedDataBytes: 0,
  });
});

test('frontend target owns a full Custom App Surface and connects through the isolated Plugin SDK', async ({
  page,
  context,
}) => {
  const request = context.request;
  await loginAsInitialAdmin(request);
  await setUiLanguage(request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };

  const before = await request.get('/api/v1/agent/settings');
  expect(before.ok(), await before.text()).toBeTruthy();
  const settings = ((await before.json()) as Envelope<SettingsView>).data;
  const patched = await request.patch('/api/v1/agent/settings', {
    headers,
    data: {
      patch: {
        feature: { enabled: true },
        plugins: { repositories: [{ url: repositoryUrl }] },
      },
      expectedVersion: settings.revision,
    },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  const catalogResponse = await request.get('/api/v1/agent/plugins/remote/catalog', { params: { repositoryUrl } });
  expect(catalogResponse.ok(), await catalogResponse.text()).toBeTruthy();
  const catalog = (await catalogResponse.json()) as Envelope<{
    publishers: Array<{ keyId: string; label: string; publicKeyPem: string }>;
    packages: Array<{ appId: string; version: string; publisherKeyId: string }>;
  }>;
  const customPackage = catalog.data.packages.find((candidate) => candidate.appId === 'nexus.custom-surface');
  expect(customPackage).toMatchObject({ version: '1.0.0' });
  const publisher = catalog.data.publishers.find((candidate) => candidate.keyId === customPackage!.publisherKeyId);
  expect(publisher).toBeDefined();
  const trusted = await request.post('/api/v1/agent/plugins/publishers', {
    headers,
    data: { publicKeyPem: publisher!.publicKeyPem, label: publisher!.label },
  });
  expect(trusted.status(), await trusted.text()).toBe(201);

  const staged = await request.post('/api/v1/agent/plugins/remote/stage', {
    headers,
    data: { repositoryUrl, appId: 'nexus.custom-surface', version: '1.0.0' },
  });
  expect(staged.status(), await staged.text()).toBe(201);
  const stageId = ((await staged.json()) as Envelope<{ id: string }>).data.id;
  const verified = await request.post('/api/v1/agent/plugins/verify', { headers, data: { stageId } });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  await expect(verified.json()).resolves.toMatchObject({
    data: {
      plugin: {
        appId: 'nexus.custom-surface',
        version: '1.0.0',
        frontendEntry: 'frontend/index.html',
        manifest: { agents: [{ id: 'custom.default' }], targets: { frontend: { entry: 'frontend/index.html' } } },
      },
    },
  });

  const installed = await request.post('/api/v1/agent/plugins/install', { headers, data: { stageId } });
  expect(installed.status(), await installed.text()).toBe(201);
  await expect(installed.json()).resolves.toMatchObject({
    data: { app: { surface: 'custom', defaultApprovalMode: 'ask' } },
  });

  await step(
    'multiple installable Agent plugins coexist and the full-stack package exposes frontend/backend targets',
    async () => {
      const officialCatalogResponse = await request.get('/api/v1/agent/plugins/official/catalog');
      expect(officialCatalogResponse.ok(), await officialCatalogResponse.text()).toBeTruthy();
      const officialCatalog = (await officialCatalogResponse.json()) as Envelope<{
        packages: Array<{ appId: string; version: string; publisherKeyId: string }>;
      }>;
      const installCatalogApp = async (appId: string): Promise<void> => {
        const catalogPackage = officialCatalog.data.packages.find((candidate) => candidate.appId === appId);
        expect(catalogPackage).toMatchObject({ version: '1.0.0', publisherKeyId: publisher!.keyId });
        const stagedApp = await request.post('/api/v1/agent/plugins/official/stage', {
          headers,
          data: { appId, version: '1.0.0' },
        });
        expect(stagedApp.status(), await stagedApp.text()).toBe(201);
        const stagedAppId = ((await stagedApp.json()) as Envelope<{ id: string }>).data.id;
        const verifiedApp = await request.post('/api/v1/agent/plugins/verify', {
          headers,
          data: { stageId: stagedAppId },
        });
        expect(verifiedApp.ok(), await verifiedApp.text()).toBeTruthy();
        if (appId === 'nexus.fullstack') {
          await expect(verifiedApp.json()).resolves.toMatchObject({
            data: {
              plugin: {
                appId: 'nexus.fullstack',
                frontendEntry: 'frontend/index.html',
                backendEntry: 'backend/index.mjs',
              },
            },
          });
        }
        const installedApp = await request.post('/api/v1/agent/plugins/install', {
          headers,
          data: { stageId: stagedAppId },
        });
        expect(installedApp.status(), await installedApp.text()).toBe(201);
      };

      await installCatalogApp('nexus.agent');
      await installCatalogApp('nexus.fullstack');

      const installationsResponse = await request.get('/api/v1/agent/plugins/installations');
      expect(installationsResponse.ok(), await installationsResponse.text()).toBeTruthy();
      const installations = (await installationsResponse.json()) as Envelope<
        Array<{ appId: string; version: string; status: string }>
      >;
      expect(installations.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ appId: 'nexus.custom-surface', version: '1.0.0', status: 'installed' }),
          expect.objectContaining({ appId: 'nexus.agent', version: '1.0.0', status: 'installed' }),
          expect.objectContaining({ appId: 'nexus.fullstack', version: '1.0.0', status: 'installed' }),
        ]),
      );

      const appsResponse = await request.get('/api/v1/agent/apps');
      expect(appsResponse.ok(), await appsResponse.text()).toBeTruthy();
      const apps = ((await appsResponse.json()) as Envelope<AppSummary[]>).data;
      expect(apps.map((candidate) => candidate.id)).toEqual(
        expect.arrayContaining(['nexus.custom-surface', 'nexus.agent', 'nexus.fullstack']),
      );
    },
  );

  await step('the Agent settings UI shows both installed plugins', async () => {
    await page.goto('/settings?tab=agent');
    const panel = page.locator('#settings-panel-agent');
    await panel
      .getByRole('navigation', { name: 'Agent settings sections', exact: true })
      .getByRole('button', { name: 'Apps and extensions', exact: true })
      .click();
    const pluginsHeading = panel.getByRole('heading', { name: 'Installable apps and skills', exact: true });
    await pluginsHeading.scrollIntoViewIfNeeded();
    const pluginsSection = pluginsHeading.locator('xpath=ancestor::section[1]');
    await expect(pluginsSection.getByText('nexus.custom-surface', { exact: true })).toBeVisible();
    await expect(pluginsSection.getByText('Custom Surface Fixture', { exact: true })).toBeVisible();
    const fullstackCatalogEntries = pluginsSection.getByText('nexus.fullstack', { exact: true });
    await expect(fullstackCatalogEntries).toHaveCount(2);
    await expect(fullstackCatalogEntries.first()).toBeVisible();
    await expect(pluginsSection.getByText('Full-stack Plugin', { exact: true }).first()).toBeVisible();
    const nexusAgentCatalogEntries = pluginsSection.getByText('nexus.agent', { exact: true });
    await expect(nexusAgentCatalogEntries.first()).toBeVisible();
    expect(await nexusAgentCatalogEntries.count()).toBeGreaterThanOrEqual(2);
    await captureFunctionalScreenshot(page, 'agent-plugins-multiple-installed.png', {
      viewport: { width: 1440, height: 900 },
    });
  });

  const app = await appSummary(request, 'nexus.custom-surface');
  const enabled = await request.patch('/api/v1/agent/apps/nexus.custom-surface', {
    headers,
    data: { enabled: true, expectedVersion: app.stateVersion },
  });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();
  await expect(enabled.json()).resolves.toMatchObject({
    data: { id: 'nexus.custom-surface', enabled: true, health: 'healthy', surface: 'custom' },
  });

  const recommendedInstall = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', {
    headers,
    data: {},
  });
  expect(recommendedInstall.ok(), await recommendedInstall.text()).toBeTruthy();
  await expect(recommendedInstall.json()).resolves.toMatchObject({
    data: { installedNow: false, app: { id: 'nexus.agent', enabled: true, health: 'healthy' } },
  });
  const hostSummary = await request.get('/api/v1/agent/summary');
  expect(hostSummary.ok(), await hostSummary.text()).toBeTruthy();
  await expect(hostSummary.json()).resolves.toMatchObject({
    data: {
      featureEnabled: true,
      hostState: 'enabled',
      apps: expect.arrayContaining([
        expect.objectContaining({ id: 'nexus.agent', enabled: true, health: 'healthy' }),
        expect.objectContaining({ id: 'nexus.custom-surface', enabled: true, health: 'healthy' }),
      ]),
    },
  });

  await page.goto('/connections');
  const hub = await openAgentHub(page);
  await hub.getByRole('button', { name: 'Switch to Custom Surface Fixture', exact: true }).click();
  const customSurface = page.frameLocator('section[aria-label="Agent"] iframe');
  await expect(customSurface.getByRole('heading', { name: 'Custom Surface Fixture' })).toBeVisible();
  await expect(customSurface.getByTestId('custom-sdk-status')).toHaveText('ready:nexus.custom-surface:custom.default', {
    timeout: 15_000,
  });
});

test('Nexus Agent Browser lifecycle cases reclaim contexts across cancellation and approval boundaries', async ({
  request,
  page,
}) => {
  await installAndRunNexusAgent(request, page, 'browser-lifecycle');
});

test('Nexus Agent subagent lifecycle preserves tool batches and reclaims child Browser contexts', async ({
  request,
  page,
}) => {
  await installAndRunNexusAgent(request, page, 'subagent');
});

test('remote signed Nexus Agent plugin installs, registers an Agent definition, and completes a real Run', async ({
  request,
  page,
}) => {
  await installAndRunNexusAgent(request, page, 'core');
});

test('installed Nexus Agent plugin uses the host-owned Agent surface and captures functional evidence', async ({
  page,
  context,
}) => {
  const { threadId, connectionId, parallelThreadId } = await installAndRunNexusAgent(context.request, page, 'surface');
  await setUiLanguage(context.request);
  const onboardingCsrf = await csrfToken(context.request);
  const recommendedInstall = await context.request.post('/api/v1/agent/onboarding/recommended-plugin/install', {
    headers: { 'X-Nexus-CSRF': onboardingCsrf },
    data: {},
  });
  expect(recommendedInstall.ok(), await recommendedInstall.text()).toBeTruthy();
  await expect(recommendedInstall.json()).resolves.toMatchObject({
    data: { installedNow: false, app: { id: 'nexus.agent', enabled: true } },
  });
  expect(threadId).not.toBe('');
  await slowStep('the merged Nexus Agent renders through the host-owned generic Agent surface', async () => {
    await page.goto('/connections');
    const hub = await openAgentHub(page);
    await hub.getByRole('button', { name: 'Switch to Nexus Agent', exact: true }).click();
    const presetThread = hub.getByRole('button').filter({ hasText: `#${threadId.slice(-6)}` });
    await expect(presetThread).toBeVisible();
    await presetThread.click();
    await expect(presetThread).toHaveAttribute('aria-current', 'true');
    await expect(hub.getByText('OK', { exact: true }).last()).toBeVisible({ timeout: 30_000 });
    const taskPanelToggle = hub.getByRole('button', { name: 'Show or hide task panel', exact: true });
    await expect(taskPanelToggle).toBeVisible();
    await expect(taskPanelToggle).toHaveAttribute('aria-expanded', 'false');
    await taskPanelToggle.click();
    const taskRail = hub.locator('#agent-task-rail');
    await expect(taskRail).toBeVisible();
    await expect(taskRail.getByText('Tasks', { exact: true })).toBeVisible();
    await taskRail.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(taskRail).toHaveCount(0);

    await step(
      'batched tool calls use one group title and show concrete tool names only in expanded details',
      async () => {
        const batchThread = hub.getByRole('button').filter({ hasText: `#${parallelThreadId.slice(-6)}` });
        await expect(batchThread).toBeVisible();
        await batchThread.click();
        await expect(batchThread).toHaveAttribute('aria-current', 'true');

        const toolCall = hub
          .locator('details')
          .filter({ has: page.locator('summary').filter({ hasText: 'Tool call' }) });
        await expect(toolCall).toHaveCount(1);
        const summary = toolCall.locator('summary');
        await expect(summary).toContainText('Tool call');
        await expect(summary).not.toContainText('machine_connection_list');
        await expect(summary).not.toContainText('file_read');
        await expect(summary.getByText('2', { exact: true })).toBeVisible();

        await summary.click();
        const details = toolCall.locator('[data-tool-name]');
        await expect(details).toHaveCount(2);
        await expect(details.nth(0)).toHaveAttribute('data-tool-name', 'machine_connection_list');
        await expect(details.nth(1)).toHaveAttribute('data-tool-name', 'file_read');
        await expect(details.nth(0)).toContainText('machine_connection_list');
        await expect(details.nth(1)).toContainText('file_read');

        await presetThread.click();
        await expect(presetThread).toHaveAttribute('aria-current', 'true');
        await expect(hub.getByText('OK', { exact: true }).last()).toBeVisible();
      },
    );

    await step('the next Run Environment uses the shared accessible Host popover contract', async () => {
      const environment = hub.getByRole('button', { name: 'Environment', exact: true });
      await expect(environment).toBeVisible();
      await expect(environment).toHaveAttribute('aria-expanded', 'false');
      await expect(environment).toContainText('Native Host');
      await environment.click();
      await expect(environment).toHaveAttribute('aria-expanded', 'true');
      const environmentDialog = page.getByRole('dialog', { name: 'Environment', exact: true });
      await expect(environmentDialog).toBeVisible();
      await expect(environmentDialog.getByText('Environment', { exact: true })).toBeVisible();
      await expect(
        environmentDialog.getByRole('button', { name: 'Native Host Run directly on host system', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(environmentDialog).toHaveCount(0);
      await expect(environment).toHaveAttribute('aria-expanded', 'false');
      await expect(environment).toBeFocused();
    });

    await step('the resize grip drives container-responsive Agent layout and persists bounds', async () => {
      const resizeHandle = hub.getByRole('button', { name: 'Resize Agent', exact: true });
      const headerThreadDelete = hub.locator('.agent-header-thread-delete');
      await expect(resizeHandle).toBeVisible();
      await expect(headerThreadDelete).toBeHidden();
      const initialBounds = await hub.boundingBox();
      expect(initialBounds).not.toBeNull();
      expect(initialBounds!.width).toBeGreaterThan(1040);

      const resizeToWidth = async (targetWidth: number, pointerId: number) => {
        const bounds = await hub.boundingBox();
        const handle = await resizeHandle.boundingBox();
        expect(bounds).not.toBeNull();
        expect(handle).not.toBeNull();
        const startX = handle!.x + handle!.width / 2;
        const startY = handle!.y + handle!.height / 2;
        const targetX = startX + targetWidth - bounds!.width;
        const pointer = {
          bubbles: true,
          pointerId,
          pointerType: 'mouse',
          isPrimary: true,
          clientY: startY,
        };
        await resizeHandle.dispatchEvent('pointerdown', {
          ...pointer,
          button: 0,
          buttons: 1,
          clientX: startX,
        });
        await page.locator('body').dispatchEvent('pointermove', {
          ...pointer,
          button: -1,
          buttons: 1,
          clientX: targetX,
        });
        await page.locator('body').dispatchEvent('pointerup', {
          ...pointer,
          button: 0,
          buttons: 0,
          clientX: targetX,
        });
      };

      await resizeToWidth(720, 41);

      const narrowBounds = await hub.boundingBox();
      expect(narrowBounds).not.toBeNull();
      expect(narrowBounds!.width).toBeLessThanOrEqual(760);
      await expect(taskPanelToggle).toBeVisible();
      await taskPanelToggle.click();
      await expect(taskRail).toBeVisible();
      await expect(taskRail.getByText('Tasks', { exact: true })).toBeVisible();
      await taskRail.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(taskRail).toHaveCount(0);
      const openThreads = hub.getByRole('button', { name: 'Open conversations', exact: true });
      await expect(openThreads).toBeVisible();
      await expect(headerThreadDelete).toBeVisible();
      await openThreads.click();
      await expect(hub.getByPlaceholder('Search conversations', { exact: true })).toBeVisible();
      const threadBackdrop = hub.getByRole('button', { name: 'Close conversations', exact: true });
      const backdropBounds = await threadBackdrop.boundingBox();
      expect(backdropBounds).not.toBeNull();
      await threadBackdrop.click({ position: { x: backdropBounds!.width - 12, y: backdropBounds!.height / 2 } });

      await page.reload();
      await openAgentHub(page);
      const restoredBounds = await hub.boundingBox();
      expect(restoredBounds).not.toBeNull();
      expect(Math.abs(restoredBounds!.width - narrowBounds!.width)).toBeLessThan(2);
      await expect(hub.getByRole('button', { name: 'Open conversations', exact: true })).toBeVisible();
      await expect(headerThreadDelete).toBeVisible();

      await resizeToWidth(initialBounds!.width, 42);
      await expect.poll(async () => (await hub.boundingBox())?.width ?? 0).toBeGreaterThan(1040);
      await expect(taskPanelToggle).toBeVisible();
      await expect(taskPanelToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(hub.getByRole('button', { name: 'Open conversations', exact: true })).toBeVisible();
      await expect(hub.getByRole('button', { name: 'Open conversations', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(headerThreadDelete).toBeHidden();
    });

    await step('users can create a new conversation and return to the existing thread', async () => {
      const presetThread = hub.getByRole('button').filter({ hasText: `#${threadId.slice(-6)}` });
      await expect(presetThread).toBeVisible();
      await presetThread.click();
      await expect(presetThread).toHaveAttribute('aria-current', 'true');

      await hub.getByRole('button', { name: 'New', exact: true }).click();
      const composer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
      await expect(composer).toBeFocused();
      await expect(presetThread).not.toHaveAttribute('aria-current', 'true');
      await expect(
        hub.locator('.agent-thread-row[aria-current="true"]').getByText('New conversation', { exact: true }),
      ).toBeVisible();

      await composer.fill('/goal UI durable goal');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText('UI durable goal');
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText(
        'Started a new Run with durable Goal revision 1',
      );
      await expect(hub.getByText('OK', { exact: true }).last()).toBeVisible({ timeout: 30_000 });

      const conversationSearch = hub.getByPlaceholder('Search conversations', { exact: true });
      await conversationSearch.fill(threadId);
      await expect(presetThread).toBeVisible();
      await expect(hub.getByRole('button').and(hub.locator('.agent-thread-row'))).toHaveCount(1);
      await presetThread.click();
      await expect(presetThread).toHaveAttribute('aria-current', 'true');
      await expect(presetThread).toContainText(`#${threadId.slice(-6)}`);
      await conversationSearch.fill('');
    });

    await step('conversation slash commands project durable Run state and reject unknown prompts', async () => {
      const commandComposer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
      const commandResult = hub.getByLabel('Command result', { exact: true });

      await commandComposer.fill('/help');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(commandResult).toContainText('/goal [text]');
      await expect(commandResult).toContainText('//');

      await commandComposer.fill('/goal');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(commandResult).toContainText('Confirm the Nexus Agent Developer Skill goal remains durable.');
      await expect(commandResult).toContainText('Goal revision 1');

      await commandComposer.fill('/plan');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(commandResult).toContainText(/Plan revision \d+/);

      await commandComposer.fill('/queue');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(commandResult).toContainText('0 pending');
      await expect(commandResult).toContainText('No pending user inputs.');

      await commandComposer.fill('/queue remove 1');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(commandResult).toContainText('Queue position 1 does not exist.');

      const unknown = '/definitely-not-an-agent-command';
      await commandComposer.fill(unknown);
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(commandResult).toContainText(`Unknown command: ${unknown}`);

      const ledger = await context.request.get(`/api/v1/apps/nexus.agent/threads/${threadId}/entries?limit=50`);
      expect(ledger.ok(), await ledger.text()).toBeTruthy();
      expect(JSON.stringify(await ledger.json())).not.toContain(unknown);

      const escapedSlash = '/' + '/literal slash prompt';
      await commandComposer.fill(escapedSlash);
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByText('/literal slash prompt', { exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const response = await context.request.get(`/api/v1/apps/nexus.agent/threads/${threadId}/entries?limit=50`);
          if (!response.ok()) return '';
          return JSON.stringify(await response.json());
        })
        .toContain('/literal slash prompt');
    });

    const threadRunsResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
    expect(threadRunsResponse.ok(), await threadRunsResponse.text()).toBeTruthy();
    const threadRunPage = (await threadRunsResponse.json()) as Envelope<{ items: RunView[] }>;
    const terminalRunStatuses = ['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'];
    const activeRun = threadRunPage.data.items.find((candidate) => !terminalRunStatuses.includes(candidate.status));
    if (activeRun) {
      await cancelRunForCleanup(context.request, activeRun.id, page);
      await waitForTerminalRun(context.request, activeRun.id);
      await page.reload();
      await openAgentHub(page);
      const presetThread = hub.getByRole('button').filter({ hasText: `#${threadId.slice(-6)}` });
      await presetThread.click();
      await expect(presetThread).toHaveAttribute('aria-current', 'true');
    }

    const modelSelector = hub.getByRole('button', { name: 'Model', exact: true });
    await expect(modelSelector).toBeVisible({ timeout: 60_000 });
    await modelSelector.click();
    const modelDialog = page.getByRole('dialog', { name: 'Model', exact: true });
    await expect(modelDialog).toBeVisible();
    await modelDialog.getByRole('button').filter({ hasText: 'e2e-model-alt' }).click();
    await expect(modelDialog).toHaveCount(0);
    await expect(modelSelector).toContainText('e2e-model-alt');

    const restoredComposer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
    const providerBeforeContinuation = await context.request.get(`${E2E_URLS.openAiProviderOrigin}/health`);
    const checkpointResponsesBefore = ((await providerBeforeContinuation.json()) as { checkpointResponses: number })
      .checkpointResponses;
    await restoredComposer.fill('Confirm the Agent composer can start the next Run from the current thread.');
    await hub.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      hub.getByText('Confirm the Agent composer can start the next Run from the current thread.', { exact: true }),
    ).toBeVisible();
    const runsResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
    expect(runsResponse.ok(), await runsResponse.text()).toBeTruthy();
    const runPage = (await runsResponse.json()) as Envelope<{ items: RunView[] }>;
    expect(runPage.data.items[0]?.definition).toMatchObject({ agentDefinitionId: 'agent.default' });
    expect(runPage.data.items.some((item) => item.definition.model?.modelId === 'e2e-model-alt')).toBeTruthy();
    const continuedRun = runPage.data.items.find((item) => item.definition.model?.modelId === 'e2e-model-alt');
    expect(continuedRun).toBeDefined();
    const continuedTerminal = await waitForTerminalRun(context.request, continuedRun!.id);
    expect(['completed', 'completed_unverified']).toContain(continuedTerminal.status);
    const providerAfterContinuation = await context.request.get(`${E2E_URLS.openAiProviderOrigin}/health`);
    expect(
      ((await providerAfterContinuation.json()) as { checkpointResponses: number }).checkpointResponses,
    ).toBeGreaterThan(checkpointResponsesBefore);
    await taskPanelToggle.click();
    await expect(taskRail).toBeVisible();
    const historyCard = taskRail.locator('[data-rail-card="history"]');
    await expect(historyCard.getByText('Run history', { exact: true })).toBeVisible();
    await captureFunctionalScreenshot(page, 'agent-run-history.png', { viewport: { width: 1440, height: 900 } });
    await captureFunctionalScreenshot(page, 'agent-nexus-agent.png', { viewport: { width: 1440, height: 900 } });

    await step('completed Runs expose details, checkpoints, and Workspace Runtime surfaces', async () => {
      await historyCard.locator(':scope > button').first().click();
      await expect(taskRail.getByRole('button', { name: 'Back to Tasks', exact: true })).toBeVisible();
      await expect(taskRail.getByText('Run overview', { exact: true })).toBeVisible();
      await expect(taskRail.getByText(/^Checkpoints · \d+$/)).toBeVisible();
      await taskRail.getByText('Optional runtime', { exact: true }).click();
      await expect(taskRail.getByText('Workspace dev environment', { exact: true })).toBeVisible();
      await captureFunctionalScreenshot(page, 'agent-run-details.png', { viewport: { width: 1440, height: 900 } });

      await taskRail.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
      await expect(taskRail.getByRole('button', { name: 'Resume as new run', exact: true })).toBeVisible();
      await captureFunctionalScreenshot(page, 'agent-checkpoint-recovery.png', {
        viewport: { width: 1440, height: 900 },
      });
      await taskRail.getByRole('button', { name: 'Back to Tasks', exact: true }).click();
      await expect(historyCard.getByText('Run history', { exact: true })).toBeVisible();
    });

    await step('Run history can open and delete a terminal historical Run', async () => {
      const beforeDeleteResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
      expect(beforeDeleteResponse.ok(), await beforeDeleteResponse.text()).toBeTruthy();
      const beforeDelete = (await beforeDeleteResponse.json()) as Envelope<{ items: RunView[] }>;
      const beforeDeleteIds = beforeDelete.data.items.map((item) => item.id);
      const currentRunId = runPage.data.items.find((item) => item.definition.model?.modelId === 'e2e-model-alt')?.id;
      expect(currentRunId).toBeTruthy();
      await historyCard.locator(':scope > button').first().click();
      await expect(taskRail.getByRole('button', { name: 'Back to Tasks', exact: true })).toBeVisible();

      await taskRail.getByRole('button', { name: 'Delete run', exact: true }).click();
      const verifyDeleteBarrier = process.env.NEXUS_E2E_DELETE_SYNC_BARRIER === '1';
      let releaseDeleteList!: () => void;
      let confirmDeleteList!: () => void;
      const deleteListHeld = new Promise<void>((resolve) => {
        confirmDeleteList = resolve;
      });
      const deleteListRelease = new Promise<void>((resolve) => {
        releaseDeleteList = resolve;
      });
      const deleteListMatcher = (url: URL) =>
        url.pathname === '/api/v1/apps/nexus.agent/runs' && url.searchParams.get('threadId') === threadId;
      if (verifyDeleteBarrier) {
        await page.route(
          deleteListMatcher,
          async (route) => {
            const response = await route.fetch();
            confirmDeleteList();
            await deleteListRelease;
            await route.fulfill({ response });
          },
          { times: 1 },
        );
      }
      const deleteProfileStarted = performance.now();
      const deleteProfileRequests: Array<{ url: string; method: string; startedMs: number; finishedMs?: number }> = [];
      const onProfileRequest = (request: import('@playwright/test').Request) => {
        if (!request.url().includes('/api/v1/apps/nexus.agent/')) return;
        deleteProfileRequests.push({
          url: request.url(),
          method: request.method(),
          startedMs: performance.now() - deleteProfileStarted,
        });
      };
      const onProfileFinished = (request: import('@playwright/test').Request) => {
        const record = deleteProfileRequests.find(
          (item) => item.url === request.url() && item.method === request.method() && item.finishedMs === undefined,
        );
        if (record) record.finishedMs = performance.now() - deleteProfileStarted;
      };
      page.on('request', onProfileRequest);
      page.on('requestfinished', onProfileFinished);
      const ledgerAfterDelete = page.waitForResponse(
        (response) => response.url().includes(`/threads/${threadId}/entries`) && response.request().method() === 'GET',
      );
      const backgroundAfterDelete = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === '/api/v1/apps/nexus.agent/runs' &&
          !url.searchParams.has('threadId') &&
          response.request().method() === 'GET'
        );
      });
      try {
        await taskRail.getByRole('button', { name: 'Confirm delete', exact: true }).click();
        if (verifyDeleteBarrier) {
          await deleteListHeld;
          const selectedThread = hub.locator('.agent-thread-row[aria-current="true"]');
          await expect(selectedThread).toHaveAttribute('aria-current', 'true');
          await expect(selectedThread).toBeDisabled();
          releaseDeleteList();
        }
        await expect(taskRail.getByRole('button', { name: 'Back to Tasks', exact: true })).toHaveCount(0);
        const responses = await Promise.all([ledgerAfterDelete, backgroundAfterDelete]);
        for (const response of responses) {
          expect(response.ok()).toBeTruthy();
          await response.finished();
        }
        if (verifyDeleteBarrier) {
          await expect(hub.locator('.agent-thread-row[aria-current="true"]')).toBeEnabled();
        }
        console.log(
          '[Run deletion UI profile]',
          JSON.stringify({ syncMs: performance.now() - deleteProfileStarted, requests: deleteProfileRequests }),
        );
      } finally {
        releaseDeleteList();
        if (verifyDeleteBarrier) await page.unroute(deleteListMatcher);
        page.off('request', onProfileRequest);
        page.off('requestfinished', onProfileFinished);
      }

      await expect
        .poll(async () => {
          const response = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
          expect(response.ok(), await response.text()).toBeTruthy();
          const page = (await response.json()) as Envelope<{ items: RunView[] }>;
          return page.data.items.length;
        })
        .toBe(beforeDeleteIds.length - 1);
      const afterDeleteResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
      expect(afterDeleteResponse.ok(), await afterDeleteResponse.text()).toBeTruthy();
      const afterDelete = (await afterDeleteResponse.json()) as Envelope<{ items: RunView[] }>;
      const afterDeleteIds = afterDelete.data.items.map((item) => item.id);
      const removedIds = beforeDeleteIds.filter((id) => !afterDeleteIds.includes(id));
      expect(removedIds).toHaveLength(1);
      expect(afterDeleteIds).toContain(currentRunId!);
    });

    await step('pending mutation approval is surfaced inline while the TaskRail is hidden', async () => {
      await taskRail.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(taskPanelToggle).toHaveAttribute('aria-expanded', 'false');

      const approvalMode = hub.getByRole('button', { name: 'Approval mode', exact: true });
      await expect(approvalMode).toContainText('Full access');
      await approvalMode.click();
      const approvalModeDialog = page.getByRole('dialog', { name: 'Approval mode', exact: true });
      await approvalModeDialog.getByRole('button', { name: /Ask when needed/ }).click();
      await expect(approvalMode).toContainText('Ask when needed');

      const targets = hub.getByRole('button', { name: 'SSH Hosts', exact: true });
      await page.evaluate(() => {
        const samples: Array<{ x: number; y: number; width: number; height: number }> = [];
        (window as typeof window & { popoverPlacementSamples?: typeof samples }).popoverPlacementSamples = samples;
        let frames = 0;
        const sample = () => {
          frames += 1;
          const panel = document.querySelector<HTMLElement>('[data-ui="popover-panel"][aria-label="SSH Hosts"]');
          if (panel && panel.getBoundingClientRect().width > 0 && getComputedStyle(panel).visibility !== 'hidden') {
            const rect = panel.getBoundingClientRect();
            if (rect.top >= 0 && rect.left >= 0)
              samples.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          }
          if (samples.length < 8 && frames < 120) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await targets.click();
      const targetsPanel = page.getByRole('dialog', { name: 'SSH Hosts', exact: true });
      await expect(targetsPanel.getByText('E2E SSH', { exact: true })).toBeVisible();
      await expect(targetsPanel.getByText('1/1')).toBeVisible();
      const bulkSelection = targetsPanel.getByRole('checkbox');
      await expect(bulkSelection).toBeChecked();
      await bulkSelection.click();
      await expect(bulkSelection).not.toBeChecked();
      await expect(targetsPanel.getByText('0/1')).toBeVisible();
      await bulkSelection.click();
      await expect(bulkSelection).toBeChecked();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as typeof window & { popoverPlacementSamples?: unknown[] }).popoverPlacementSamples?.length ?? 0,
          ),
        )
        .toBe(8);
      const samples = await page.evaluate(
        () =>
          (window as typeof window & { popoverPlacementSamples: Array<{ x: number; y: number }> })
            .popoverPlacementSamples,
      );
      expect(
        Math.max(...samples.map((sample) => sample.x)) - Math.min(...samples.map((sample) => sample.x)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...samples.map((sample) => sample.y)) - Math.min(...samples.map((sample) => sample.y)),
      ).toBeLessThanOrEqual(1);
      await targets.click();
      await restoredComposer.fill(
        `Request the bounded shell approval exactly once. E2E_APPROVAL_CONNECTION_ID=${connectionId}`,
      );
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(taskPanelToggle).toHaveText('1', { timeout: 30_000 });
      await expect(hub.getByText('Agent needs your approval', { exact: true })).toBeVisible();
      await expect(hub.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
      await expect(hub.getByRole('button', { name: 'Deny + guidance', exact: true })).toBeVisible();
      await expect(hub.getByRole('button', { name: 'Approve and run', exact: true })).toBeVisible();

      const approvalRunsResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
      expect(approvalRunsResponse.ok(), await approvalRunsResponse.text()).toBeTruthy();
      const approvalRunPage = (await approvalRunsResponse.json()) as Envelope<{ items: RunView[] }>;
      const approvalRun = approvalRunPage.data.items.find((item) => item.status === 'awaiting_approval');
      expect(approvalRun).toBeDefined();
      expect(approvalRun!.definition.approvalMode).toBe('ask');
      expect(approvalRun!.definition.connectionIds).toContain(connectionId);
      expect(approvalRun!.definition.connectionIds).toEqual([connectionId]);

      await restoredComposer.fill('/goal Keep the pending approval and use this updated goal afterward.');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText('Goal updated at revision');
      await expect(taskPanelToggle).toHaveText('1');

      await restoredComposer.fill('/interrupt This must not supersede the pending approval.');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText(
        '/interrupt only works while the Root model is actively streaming.',
      );
      await expect(taskPanelToggle).toHaveText('1');

      await page.setViewportSize({ width: 1000, height: 800 });
      await captureFunctionalScreenshot(page, 'agent-approval-narrow.png', { viewport: { width: 1000, height: 800 } });
      await hub.getByRole('button', { name: 'Approve and run', exact: true }).click();
      const terminal = await waitForTerminalRun(context.request, approvalRun!.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      await expect(hub.getByText('Agent needs your approval', { exact: true })).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await step('terminal Run failures are surfaced directly in the conversation', async () => {
      const restoredComposer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
      await restoredComposer.fill('E2E_FAIL_RUN Surface this intentional terminal failure in the chat.');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByText('Run failed', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(hub.getByText(/This run did not finish/)).toBeVisible();

      const runsResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
      expect(runsResponse.ok(), await runsResponse.text()).toBeTruthy();
      const runPage = (await runsResponse.json()) as Envelope<{ items: RunView[] }>;
      expect(runPage.data.items[0]?.status).toBe('failed');
    });

    await step(
      'globally denied SSH targets disappear from the Agent selector and return when allowed again',
      async () => {
        const csrf = await csrfToken(context.request);
        const denylistResponse = await context.request.get('/api/v1/agent/target-denylist');
        expect(denylistResponse.ok(), await denylistResponse.text()).toBeTruthy();
        const original = (await denylistResponse.json()) as Envelope<{
          revision: number;
          list: Array<{ connectionId: number; reason: string }>;
        }>;
        const blocked = await context.request.put('/api/v1/agent/target-denylist', {
          headers: { 'X-Nexus-CSRF': csrf },
          data: {
            connectionIds: [connectionId],
            reason: 'E2E Agent selector denylist',
            expectedRevision: original.data.revision,
          },
        });
        expect(blocked.ok(), await blocked.text()).toBeTruthy();
        const blockedView = (await blocked.json()) as Envelope<{ revision: number }>;

        const targets = hub.getByRole('button', { name: 'SSH Hosts', exact: true });
        await targets.click();
        const targetsPanel = page.getByRole('dialog', { name: 'SSH Hosts', exact: true });
        await expect(targetsPanel.getByText('E2E SSH', { exact: true })).toHaveCount(0, { timeout: 10_000 });
        await expect(targetsPanel.getByText('No SSH connections are available.', { exact: true })).toBeVisible();
        await targets.click();

        const restored = await context.request.put('/api/v1/agent/target-denylist', {
          headers: { 'X-Nexus-CSRF': csrf },
          data: {
            connectionIds: original.data.list.map((entry) => entry.connectionId),
            reason: original.data.list[0]?.reason ?? 'E2E restore target policy',
            expectedRevision: blockedView.data.revision,
          },
        });
        expect(restored.ok(), await restored.text()).toBeTruthy();
        await targets.click();
        await expect(targetsPanel.getByText('E2E SSH', { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(targetsPanel.getByText('0/1')).toBeVisible();
        await targetsPanel.getByRole('button').filter({ hasText: 'E2E SSH' }).click();
        await expect(targetsPanel.getByText('1/1')).toBeVisible();
        await targets.click();
      },
    );

    await step('conversations support guarded single-delete and delete-all flows', async () => {
      await hub.getByRole('button', { name: 'New', exact: true }).click();
      await expect(hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...')).toBeFocused();
      const currentThreadItem = hub.locator('.agent-thread-row[aria-current="true"]').locator('..');
      await expect(currentThreadItem.getByRole('button', { name: 'Delete conversation', exact: true })).toBeVisible();

      const afterCreateResponse = await context.request.get('/api/v1/apps/nexus.agent/threads?limit=100');
      expect(afterCreateResponse.ok(), await afterCreateResponse.text()).toBeTruthy();
      const afterCreate = (await afterCreateResponse.json()) as Envelope<{
        items: Array<{ id: string; version: number }>;
      }>;
      const selectedThreadIdSuffix = (await currentThreadItem.locator('.agent-thread-meta').innerText()).match(
        /#([a-f0-9]{6})/,
      )?.[1];
      const singleDeleteId = afterCreate.data.items.find(
        ({ id }) => selectedThreadIdSuffix !== undefined && id.endsWith(selectedThreadIdSuffix),
      )?.id;
      expect(singleDeleteId).toBeTruthy();
      if (!singleDeleteId) throw new Error('Selected conversation was missing from the thread list');

      await currentThreadItem.getByRole('button', { name: 'Delete conversation', exact: true }).click();
      await currentThreadItem
        .getByRole('button', { name: 'Click again to delete this conversation', exact: true })
        .click();
      await expect
        .poll(async () => {
          const response = await context.request.get(`/api/v1/apps/nexus.agent/threads/${singleDeleteId}`);
          return response.status();
        })
        .toBe(404);

      const csrf = await csrfToken(context.request);
      const createExtra = async (title: string): Promise<string> => {
        const response = await context.request.post('/api/v1/apps/nexus.agent/threads', {
          headers: { 'X-Nexus-CSRF': csrf },
          data: { title },
        });
        expect(response.status(), await response.text()).toBe(201);
        return ((await response.json()) as Envelope<{ id: string }>).data.id;
      };
      const extraIds = [await createExtra('Delete all E2E A'), await createExtra('Delete all E2E B')];

      await expect(hub.getByRole('button', { name: 'Delete all conversations', exact: true })).toBeVisible();
      await hub.getByRole('button', { name: 'Delete all conversations', exact: true }).click();
      await hub.getByRole('button', { name: 'Click again to delete all conversations', exact: true }).click();

      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/apps/nexus.agent/threads?limit=100');
          expect(response.ok(), await response.text()).toBeTruthy();
          const page = (await response.json()) as Envelope<{ items: Array<{ id: string }> }>;
          return page.data.items;
        })
        .toHaveLength(1);
      const finalThreadsResponse = await context.request.get('/api/v1/apps/nexus.agent/threads?limit=100');
      const finalThreads = (await finalThreadsResponse.json()) as Envelope<{ items: Array<{ id: string }> }>;
      expect(finalThreads.data.items).toHaveLength(1);
      expect(extraIds).not.toContain(finalThreads.data.items[0]!.id);
    });

    await step('Artifact upload flows into the unified Agent file library', async () => {
      const attachmentsButton = hub.getByRole('button', { name: /^Files \(\d+\)$/ }).first();
      await attachmentsButton.click();
      const attachmentsDialog = page.getByRole('dialog', { name: /^Files \(\d+\)$/ });
      await attachmentsDialog.locator('input[type="file"]').setInputFiles({
        name: 'agent-ui-evidence.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Agent UI functional evidence\n'),
      });
      await expect(attachmentsButton).toBeVisible();
      await attachmentsButton.click();
      await hub
        .getByRole('navigation', { name: 'Agent views' })
        .getByRole('button', { name: 'Files', exact: true })
        .click();
      await expect(hub.getByText('agent-ui-evidence.txt', { exact: true })).toBeVisible();
      const artifactRow = hub.locator('article').filter({ hasText: 'agent-ui-evidence.txt' });
      await artifactRow.getByRole('button', { name: 'Retain', exact: true }).click();
      await expect(artifactRow.getByRole('button', { name: 'Release retention', exact: true })).toBeVisible();
      await captureFunctionalScreenshot(page, 'agent-artifact-library.png', { viewport: { width: 1440, height: 900 } });
    });
  });
});
