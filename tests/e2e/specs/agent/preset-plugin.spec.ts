import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { slowStep, step } from '../../support/steps';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';

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
const providerBase = 'http://127.0.0.1:29091/v1';
const providerSecret = 'e2e-provider-secret';

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

const installAndRunNexusAgent = async (
  request: APIRequestContext,
): Promise<{ threadId: string; connectionId: number }> => {
  await loginAsInitialAdmin(request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };
  const connectionId = await ensureTestSshConnection(request);

  await step('configure the remote repository without installing a Runner', async () => {
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
      data: { available: false, reason: 'runner_not_configured' },
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
      declaredCapabilities: string[];
      grants: Array<{ capability: string }>;
    }>;
    expect(grantView.data.declaredCapabilities).toEqual(
      expect.arrayContaining(['workspace.read', 'workspace.write', 'browser.read', 'browser.interact']),
    );
    expect(grantView.data.grants).toHaveLength(0);
    const replaced = await request.put('/api/v1/agent/apps/nexus.agent/grants', {
      headers,
      data: {
        capabilities: ['machine.files.read', 'machine.shell.execute'],
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
    const created = await request.post('/api/v1/agent/ai/providers', {
      headers,
      data: {
        kind: 'openai-compatible',
        displayName: 'Preset E2E Provider',
        baseUrl: providerBase,
        protocol: 'chat-completions',
        credential: providerSecret,
        models: [
          { id: 'e2e-model', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true },
          { id: 'e2e-model-alt', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true },
        ],
        enabled: true,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    provider = ((await created.json()) as Envelope<ProviderView>).data;
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

  let threadId = '';
  await step('the plugin AgentDefinition is visible and completes a real Run', async () => {
    const definitions = await request.get('/api/v1/apps/nexus.agent/agent-definitions');
    expect(definitions.ok(), await definitions.text()).toBeTruthy();
    await expect(definitions.json()).resolves.toMatchObject({
      data: [{ id: 'agent.default', version: '1.0.0', displayName: 'Nexus Agent' }],
    });

    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Preset E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    threadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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
    const goalDeadline = Date.now() + 5_000;
    let goalRun: RunView | null = null;
    while (!goalRun && Date.now() < goalDeadline) {
      const latestResponse = await request.get(`/api/v1/apps/nexus.agent/runs/${run.id}`);
      expect(latestResponse.ok(), await latestResponse.text()).toBeTruthy();
      const latest = ((await latestResponse.json()) as Envelope<RunView>).data;
      expect(latest.status).toBe('running');
      const goalUpdated = await request.post(`/api/v1/apps/nexus.agent/runs/${run.id}/goal`, {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: { schemaVersion: 1, text: durableGoal, expectedVersion: latest.version },
      });
      if (goalUpdated.ok()) {
        goalRun = ((await goalUpdated.json()) as Envelope<RunView>).data;
        break;
      }
      const failure = (await goalUpdated.json()) as { error?: { code?: string } };
      expect(failure.error?.code).toBe('STATE_CONFLICT');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(goalRun).not.toBeNull();
    expect(goalRun!.goal).toMatchObject({ text: durableGoal, revision: 1 });

    const terminal = await waitForTerminalRun(request, run.id);
    expect(['completed', 'completed_unverified']).toContain(terminal.status);
    expect(terminal.goal).toMatchObject({ text: durableGoal, revision: 1 });
    const ledger = await request.get(`/api/v1/apps/nexus.agent/threads/${threadId}/entries?limit=50`);
    expect(ledger.ok(), await ledger.text()).toBeTruthy();
    expect(JSON.stringify(await ledger.json())).toContain('OK');
  });

  await step('the merged App exposes Operations separately through metadata-first Skill loading', async () => {
    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Operations Skill E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const operationsThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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

  await step('control-risk tools persist the current enum without compatibility remapping', async () => {
    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Control risk enum E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const controlThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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

  await step('one model turn persists and completes every tool call before the next inference', async () => {
    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Multi-tool batch E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const batchThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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

  await step('parallel-safe read tools from one model turn settle as one complete batch', async () => {
    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Parallel read batch E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const batchThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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
    expect(serialized).toContain('machine_list_connections');
    expect(serialized).toContain('machine_read_file');
    expect(serialized).toContain('nexus-e2e-seed');
  });

  await step('subagent history preserves one assistant turn with every tool call and result', async () => {
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
            capabilities: [],
            peerMessaging: 'parent-child',
            mutationMode: 'read-only',
            maxSteps: 8,
            failureMode: 'isolate',
          },
        ],
      },
    });
    expect(configured.ok(), await configured.text()).toBeTruthy();

    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Subagent multi-tool batch E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const threadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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
  });

  await step('machine_read_file reads a selected SSH target through the bounded SFTP capability', async () => {
    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Machine read-file E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const readThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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
    expect(serialized).toContain('machine_read_file');
    expect(serialized).toContain('nexus-e2e-seed');
  });

  await step('a confirmed mutation is not executed twice when the model repeats the identical proposal', async () => {
    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Duplicate mutation guard E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const duplicateThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        schemaVersion: 1,
        threadId: duplicateThreadId,
        input: {
          text: `E2E_DUPLICATE_MUTATION_CONNECTION_ID=${connectionId} Execute the bounded mutation once, then detect the provider's duplicate proposal.`,
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
    expect(serialized).toContain('MUTATION_ALREADY_CONFIRMED');
    expect(serialized).toContain('duplicate-e2e');
  });

  await step('strict interrupt supersedes only a streaming model and drains the durable input queue', async () => {
    const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
      headers,
      data: { title: 'Preset interrupt E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    const interruptThreadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
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

    const interrupted = await request.post(`/api/v1/apps/nexus.agent/runs/${run.id}/interrupt`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        schemaVersion: 1,
        text: 'E2E_INTERRUPT_RESUME Continue from the new user input.',
        artifactRefs: [],
        expectedVersion: running.version,
      },
    });
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

  return { threadId, connectionId };
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
        runnerEntry: 'runner/index.mjs',
      },
    },
  });

  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  const panel = page.locator('#settings-panel-agent');
  await panel
    .getByRole('navigation', { name: 'Agent settings sections', exact: true })
    .getByRole('button', { name: 'Plugins & Security', exact: true })
    .click();
  const pluginsHeading = panel.getByRole('heading', { name: 'Installable apps and skills', exact: true });
  await pluginsHeading.scrollIntoViewIfNeeded();
  const pluginsSection = pluginsHeading.locator('xpath=ancestor::section[1]');
  await expect(pluginsSection.getByText('Nexus first-party catalog', { exact: true })).toBeVisible();
  await expect(pluginsSection.getByText('Publisher pinned by Host', { exact: true })).toBeVisible();
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
      method: 'storage.put',
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
    'multiple installable Agent plugins coexist and the full-stack package exposes all target classes',
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
                runnerEntry: 'runner/index.mjs',
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
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Agent', exact: true }).click();
    const panel = page.locator('#settings-panel-agent');
    await panel
      .getByRole('navigation', { name: 'Agent settings sections', exact: true })
      .getByRole('button', { name: 'Plugins & Security', exact: true })
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

test('remote signed Nexus Agent plugin installs, registers an Agent definition, and completes a real Run', async ({
  request,
}) => {
  await installAndRunNexusAgent(request);
});

test('installed Nexus Agent plugin uses the host-owned Agent surface and captures functional evidence', async ({
  page,
  context,
}) => {
  const { threadId, connectionId } = await installAndRunNexusAgent(context.request);
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
    const presetThread = hub.getByRole('button').filter({ hasText: 'Preset E2E thread' });
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
      await expect(resizeHandle).toBeVisible();
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
      await openThreads.click();
      await expect(hub.getByPlaceholder('Search conversations', { exact: true })).toBeVisible();
      await hub.getByRole('button', { name: 'Close conversations', exact: true }).click();

      await page.reload();
      await openAgentHub(page);
      const restoredBounds = await hub.boundingBox();
      expect(restoredBounds).not.toBeNull();
      expect(Math.abs(restoredBounds!.width - narrowBounds!.width)).toBeLessThan(2);
      await expect(hub.getByRole('button', { name: 'Open conversations', exact: true })).toBeVisible();

      await resizeToWidth(initialBounds!.width, 42);
      await expect.poll(async () => (await hub.boundingBox())?.width ?? 0).toBeGreaterThan(1040);
      await expect(taskPanelToggle).toBeVisible();
      await expect(taskPanelToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(hub.getByRole('button', { name: 'Open conversations', exact: true })).toBeHidden();
    });

    await step('users can create a new conversation and return to the existing thread', async () => {
      const presetThread = hub.getByRole('button').filter({ hasText: 'Preset E2E thread' });
      await expect(presetThread).toBeVisible();
      await presetThread.click();
      await expect(presetThread).toHaveAttribute('aria-current', 'true');

      await hub.getByRole('button', { name: 'New', exact: true }).click();
      const composer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
      await expect(composer).toBeFocused();
      await expect(presetThread).not.toHaveAttribute('aria-current', 'true');
      await expect(hub.getByText('New conversation', { exact: true })).toHaveCount(2);

      await composer.fill('/goal UI durable goal');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText('UI durable goal');
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText(
        'Started a new Run with durable Goal revision 1',
      );
      await expect(hub.getByText('OK', { exact: true }).last()).toBeVisible({ timeout: 30_000 });

      const conversationSearch = hub.getByPlaceholder('Search conversations', { exact: true });
      await conversationSearch.fill('Preset E2E');
      await expect(presetThread).toBeVisible();
      await expect(hub.getByRole('button').filter({ hasText: 'New conversation' })).toHaveCount(0);
      await presetThread.click();
      await expect(presetThread).toHaveAttribute('aria-current', 'true');
      await expect(hub.getByText('Preset E2E thread', { exact: true })).toHaveCount(2);
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
      await expect(hub.getByText('OK', { exact: true })).toHaveCount(2, { timeout: 30_000 });
    });

    const modelSelector = hub.getByRole('button', { name: 'Model', exact: true });
    await modelSelector.click();
    const modelDialog = page.getByRole('dialog', { name: 'Model', exact: true });
    await expect(modelDialog).toBeVisible();
    await modelDialog.getByRole('button').filter({ hasText: 'e2e-model-alt' }).click();
    await expect(modelDialog).toHaveCount(0);
    await expect(modelSelector).toContainText('e2e-model-alt');

    const restoredComposer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
    await restoredComposer.fill('Confirm the Agent composer can start the next Run from the current thread.');
    await hub.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      hub.getByText('Confirm the Agent composer can start the next Run from the current thread.', { exact: true }),
    ).toBeVisible();
    await expect(hub.getByText('OK', { exact: true })).toHaveCount(3, { timeout: 30_000 });
    const runsResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
    expect(runsResponse.ok(), await runsResponse.text()).toBeTruthy();
    const runPage = (await runsResponse.json()) as Envelope<{ items: RunView[] }>;
    expect(runPage.data.items[0]?.definition).toMatchObject({ agentDefinitionId: 'agent.default' });
    expect(runPage.data.items.some((item) => item.definition.model?.modelId === 'e2e-model-alt')).toBeTruthy();
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
      await taskRail.getByRole('button', { name: 'Confirm delete', exact: true }).click();
      await expect(taskRail.getByRole('button', { name: 'Back to Tasks', exact: true })).toHaveCount(0);

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
      await targets.click();
      const targetsPanel = page.getByRole('dialog', { name: 'SSH Hosts', exact: true });
      await expect(targetsPanel.getByText('E2E SSH', { exact: true })).toBeVisible();
      await expect(targetsPanel.getByText('1/1')).toBeVisible();
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
      const singleDeleteId = afterCreate.data.items[0]!.id;

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
