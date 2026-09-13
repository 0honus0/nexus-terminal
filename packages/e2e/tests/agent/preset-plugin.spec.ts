import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';

type Envelope<T> = { data: T; requestId: string };
type SettingsView = {
  requestedSettings: { plugins: { repositories: Array<{ url: string; privateHostExceptions: string[] }> } };
  revision: number;
};
type AppSummary = {
  id: string;
  displayName: string;
  version: string;
  surface: 'builtin' | 'agent' | 'custom' | 'none';
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
  definition: { agentDefinitionId: string; model?: { modelId: string }; connectionIds: number[] };
};

const repositoryUrl = `${E2E_URLS.pluginRepositoryOrigin}/catalog.json`;
const repositoryException = `127.0.0.1:${new URL(E2E_URLS.pluginRepositoryOrigin).port}`;
const providerBase = 'http://127.0.0.1:29091/v1';
const providerException = '127.0.0.1:29091';
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
          plugins: { repositories: [{ url: repositoryUrl, privateHostExceptions: [repositoryException] }] },
          budget: { maxOutputTokens: 16 },
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
      packages: Array<{ appId: string; version: string; publisherKeyId: string; sha256: string; sizeBytes: number }>;
    }>;
    expect(catalog.data.repositoryUrl).toBe(repositoryUrl);
    expect(catalog.data.packages).toContainEqual(expect.objectContaining({ appId: 'nexus.agent', version: '1.0.0' }));
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
      data: { plugin: { appId: 'nexus.agent', status: 'installed' }, app: { surface: 'agent' } },
    });
  });

  await step('grant model/run and bounded SSH mutation authority, then enable the installed Nexus Agent', async () => {
    const grants = await request.get('/api/v1/agent/apps/nexus.agent/grants');
    expect(grants.ok(), await grants.text()).toBeTruthy();
    const grantView = (await grants.json()) as Envelope<{
      policyRevision: number;
      declaredCapabilities: string[];
      grants: Array<{ capability: string }>;
    }>;
    expect(grantView.data.declaredCapabilities).toEqual(
      expect.arrayContaining(['ai.model.use', 'runs.execute', 'workspace.runtime.execute', 'browser.operate']),
    );
    expect(grantView.data.grants).toHaveLength(0);
    const replaced = await request.put('/api/v1/agent/apps/nexus.agent/grants', {
      headers,
      data: {
        capabilities: ['ai.model.use', 'runs.execute', 'machine.shell.execute'],
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
        credential: providerSecret,
        models: [
          { id: 'e2e-model', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true },
          { id: 'e2e-model-alt', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true },
        ],
        privateHostExceptions: [providerException],
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
          text: 'E2E_GOAL_UPDATE_HOLD E2E_EXPECT_DEVELOPER_SKILL Implement and test a small code change, then confirm the Nexus Agent is running.',
          artifactRefs: [],
        },
        agentDefinitionId: 'agent.default',
        model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
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
    expect(serialized).toContain('nexus.operations');
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
      patch: { plugins: { repositories: [{ url: repositoryUrl, privateHostExceptions: [repositoryException] }] } },
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
    packages: Array<{ appId: string; version: string; publisherKeyId: string }>;
  }>;
  expect(catalog.data.packages.map((candidate) => candidate.appId).sort()).toEqual(['nexus.agent', 'nexus.fullstack']);
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
  const pluginsHeading = panel.getByRole('heading', { name: 'Installable apps and skills', exact: true });
  await pluginsHeading.scrollIntoViewIfNeeded();
  const pluginsSection = pluginsHeading.locator('xpath=ancestor::section[1]');
  await expect(pluginsSection.getByText('Nexus first-party catalog', { exact: true })).toBeVisible();
  await expect(pluginsSection.getByText('Publisher pinned by Host', { exact: true })).toBeVisible();
  await expect(pluginsSection.getByText('nexus.agent', { exact: true })).toBeVisible();
  await expect(pluginsSection.getByText('nexus.fullstack', { exact: true })).toBeVisible();
});

test('frontend target owns a full Custom App Surface and connects through the isolated Plugin SDK', async ({
  page,
  context,
}) => {
  const request = context.request;
  await loginAsInitialAdmin(request);
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
        plugins: { repositories: [{ url: repositoryUrl, privateHostExceptions: [repositoryException] }] },
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
  await expect(installed.json()).resolves.toMatchObject({ data: { app: { surface: 'custom' } } });

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
    const pluginsHeading = panel.getByRole('heading', { name: 'Installable apps and skills', exact: true });
    await pluginsHeading.scrollIntoViewIfNeeded();
    const pluginsSection = pluginsHeading.locator('xpath=ancestor::section[1]');
    await expect(pluginsSection.getByText('nexus.custom-surface', { exact: true })).toBeVisible();
    await expect(pluginsSection.getByText('nexus.agent', { exact: true })).toBeVisible();
    await expect(pluginsSection.getByText('nexus.fullstack', { exact: true })).toBeVisible();
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

  await page.goto('/connections');
  await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
  const hub = page.locator('section[aria-label="Agent"]');
  await expect(hub).toBeVisible();
  await hub.getByLabel('Agent app', { exact: true }).selectOption('nexus.custom-surface');
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
  await step('the merged Nexus Agent renders through the host-owned generic Agent surface', async () => {
    await page.goto('/connections');
    await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
    const hub = page.locator('section[aria-label="Agent"]');
    await expect(hub).toBeVisible();
    await hub.getByLabel('Agent app', { exact: true }).selectOption('nexus.agent');
    await expect(hub.getByRole('button').filter({ hasText: 'Preset E2E thread' })).toBeVisible();
    await expect(hub.getByText('OK', { exact: true })).toBeVisible();
    await expect(hub.getByText('Agent workspace', { exact: true })).toBeVisible();
    await expect(hub.getByText('Execution state', { exact: true })).toBeVisible();

    await step('the Next Run Environment uses the shared accessible Host popover contract', async () => {
      await expect(hub.getByText('Next Run', { exact: true })).toBeVisible();
      const environment = hub.getByRole('button', { name: 'Environment', exact: true });
      await expect(environment).toBeVisible();
      await expect(environment).toHaveAttribute('aria-expanded', 'false');
      await expect(environment).toContainText('No Workspace');
      await environment.click();
      await expect(environment).toHaveAttribute('aria-expanded', 'true');
      await expect(
        hub.getByText(
          "Workspace creation consumes this Run's frozen Environment snapshot; recipe and toolchain choices cannot change mid-Run.",
        ),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(environment).toHaveAttribute('aria-expanded', 'false');
      await expect(environment).toBeFocused();
    });

    await step('the resize grip drives container-responsive Agent layout and persists bounds', async () => {
      const resizeHandle = hub.getByRole('button', { name: 'Resize Agent', exact: true });
      await expect(resizeHandle).toBeVisible();
      const initialBounds = await hub.boundingBox();
      const initialHandle = await resizeHandle.boundingBox();
      expect(initialBounds).not.toBeNull();
      expect(initialHandle).not.toBeNull();
      expect(initialBounds!.width).toBeGreaterThan(1040);

      await page.mouse.move(initialHandle!.x + initialHandle!.width / 2, initialHandle!.y + initialHandle!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        initialHandle!.x + initialHandle!.width / 2 - 390,
        initialHandle!.y + initialHandle!.height / 2,
      );
      await page.mouse.up();

      const narrowBounds = await hub.boundingBox();
      expect(narrowBounds).not.toBeNull();
      expect(narrowBounds!.width).toBeLessThanOrEqual(760);
      await expect(hub.getByText('Execution state', { exact: true })).toBeHidden();
      const openThreads = hub.getByRole('button', { name: 'Open conversations', exact: true });
      await expect(openThreads).toBeVisible();
      await openThreads.click();
      await expect(hub.getByPlaceholder('Search conversations', { exact: true })).toBeVisible();
      await hub.getByRole('button', { name: 'Close conversations', exact: true }).click();

      await page.reload();
      await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
      await expect(hub).toBeVisible();
      const restoredBounds = await hub.boundingBox();
      expect(restoredBounds).not.toBeNull();
      expect(Math.abs(restoredBounds!.width - narrowBounds!.width)).toBeLessThan(2);
      await expect(hub.getByRole('button', { name: 'Open conversations', exact: true })).toBeVisible();

      const restoredHandle = await hub.getByRole('button', { name: 'Resize Agent', exact: true }).boundingBox();
      expect(restoredHandle).not.toBeNull();
      await page.mouse.move(
        restoredHandle!.x + restoredHandle!.width / 2,
        restoredHandle!.y + restoredHandle!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        restoredHandle!.x + restoredHandle!.width / 2 + (initialBounds!.width - restoredBounds!.width),
        restoredHandle!.y + restoredHandle!.height / 2,
      );
      await page.mouse.up();
      await expect(hub.getByText('Execution state', { exact: true })).toBeVisible();
      await expect(hub.getByRole('button', { name: 'Open conversations', exact: true })).toBeHidden();
    });

    await step('users can name a new conversation and return to the existing thread', async () => {
      await hub.getByRole('button', { name: 'New', exact: true }).click();
      await hub.getByLabel('Conversation title', { exact: true }).fill('UI named thread');
      await hub.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(hub.getByText('UI named thread', { exact: true })).toHaveCount(2);

      const namedComposer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
      await namedComposer.fill('/goal UI named durable goal');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText('UI named durable goal');
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText(
        'Started a new Run with durable Goal revision 1',
      );
      await expect(hub.getByText('OK', { exact: true }).last()).toBeVisible({ timeout: 30_000 });

      const conversationSearch = hub.getByPlaceholder('Search conversations', { exact: true });
      await conversationSearch.fill('UI named');
      await expect(hub.getByRole('button').filter({ hasText: 'Preset E2E thread' })).toHaveCount(0);
      await expect(hub.getByRole('button').filter({ hasText: 'UI named thread' })).toBeVisible();
      await conversationSearch.fill('');
      await hub.getByRole('button').filter({ hasText: 'Preset E2E thread' }).click();
      await expect(hub.getByText('Preset E2E thread', { exact: true })).toHaveCount(2);
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

    const modelSelect = hub.getByLabel('Run model', { exact: true });
    await modelSelect.selectOption({ label: 'Preset E2E Provider · e2e-model-alt' });
    const composer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');

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
    await expect(hub.getByLabel('Run history', { exact: true })).toBeVisible();
    await captureFunctionalScreenshot(page, 'agent-run-history.png', { viewport: { width: 1440, height: 900 } });
    await captureFunctionalScreenshot(page, 'agent-nexus-agent.png', { viewport: { width: 1440, height: 900 } });

    await step('completed Runs expose details, checkpoints, Workspace Runtime, and Subagent surfaces', async () => {
      await hub.getByRole('button', { name: 'Details', exact: true }).first().click();
      const drawer = hub.getByLabel('Run details', { exact: true });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('Run overview', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Checkpoints', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Workspace dev environment', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Subagents', { exact: true })).toBeVisible();
      await captureFunctionalScreenshot(page, 'agent-run-details.png', { viewport: { width: 1440, height: 900 } });

      await drawer.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
      await expect(drawer.getByRole('button', { name: 'Resume as new run', exact: true })).toBeVisible();
      await captureFunctionalScreenshot(page, 'agent-checkpoint-recovery.png', {
        viewport: { width: 1440, height: 900 },
      });
      await drawer.getByRole('button', { name: 'Close run details', exact: true }).click();
      await expect(drawer).toHaveCount(0);
    });

    await step('Run history can open and delete a terminal historical Run', async () => {
      const beforeDeleteResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
      expect(beforeDeleteResponse.ok(), await beforeDeleteResponse.text()).toBeTruthy();
      const beforeDelete = (await beforeDeleteResponse.json()) as Envelope<{ items: RunView[] }>;
      const history = hub.getByLabel('Run history', { exact: true });
      await history.selectOption({ index: 1 });
      const deletedRunId = await history.inputValue();
      expect(beforeDelete.data.items.some((item) => item.id === deletedRunId)).toBeTruthy();

      const historicalDrawer = hub.getByLabel('Run details', { exact: true });
      await expect(historicalDrawer).toBeVisible();
      await historicalDrawer.getByRole('button', { name: 'Delete run', exact: true }).click();
      await historicalDrawer.getByRole('button', { name: 'Confirm delete', exact: true }).click();
      await expect(historicalDrawer).toHaveCount(0);

      await expect
        .poll(async () => {
          const response = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
          expect(response.ok(), await response.text()).toBeTruthy();
          const page = (await response.json()) as Envelope<{ items: RunView[] }>;
          return page.data.items.map((item) => item.id);
        })
        .not.toContain(deletedRunId);
      await expect(hub.locator(`select[aria-label="Run history"] option[value="${deletedRunId}"]`)).toHaveCount(0);
    });

    await step('pending mutation approval remains actionable when the TaskRail is hidden', async () => {
      const targets = hub.getByRole('button', { name: 'SSH targets', exact: true });
      await targets.click();
      const targetsPanel = hub.getByRole('dialog', { name: 'SSH targets', exact: true });
      await expect(targetsPanel.getByText('E2E SSH', { exact: true })).toBeVisible();
      await targetsPanel.getByRole('checkbox').check();
      await targets.click();
      await restoredComposer.fill(
        `Request the bounded shell approval exactly once. E2E_APPROVAL_CONNECTION_ID=${connectionId}`,
      );
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByRole('button', { name: 'Open 1 pending approvals', exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const approvalRunsResponse = await context.request.get(`/api/v1/apps/nexus.agent/runs?threadId=${threadId}`);
      expect(approvalRunsResponse.ok(), await approvalRunsResponse.text()).toBeTruthy();
      const approvalRunPage = (await approvalRunsResponse.json()) as Envelope<{ items: RunView[] }>;
      const approvalRun = approvalRunPage.data.items.find((item) => item.status === 'awaiting_approval');
      expect(approvalRun).toBeDefined();
      expect(approvalRun!.definition.connectionIds).toEqual([connectionId]);

      await restoredComposer.fill('/goal Keep the pending approval and use this updated goal afterward.');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText('Goal updated at revision');
      await expect(hub.getByRole('button', { name: 'Open 1 pending approvals', exact: true })).toBeVisible();

      await restoredComposer.fill('/interrupt This must not supersede the pending approval.');
      await hub.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(hub.getByLabel('Command result', { exact: true })).toContainText(
        '/interrupt only works while the Root model is actively streaming.',
      );
      await expect(hub.getByRole('button', { name: 'Open 1 pending approvals', exact: true })).toBeVisible();

      await page.setViewportSize({ width: 1000, height: 800 });
      await hub.getByRole('button', { name: 'Open 1 pending approvals', exact: true }).click();
      const approvalDrawer = hub.getByLabel('Run details', { exact: true });
      await expect(approvalDrawer.getByText('Pending approvals', { exact: true })).toBeVisible();
      await captureFunctionalScreenshot(page, 'agent-approval-narrow.png', { viewport: { width: 1000, height: 800 } });
      await approvalDrawer.getByRole('button', { name: 'Approve and run', exact: true }).click();
      const terminal = await waitForTerminalRun(context.request, approvalRun!.id);
      expect(['completed', 'completed_unverified']).toContain(terminal.status);
      await expect(approvalDrawer.getByText('Approval status: approved', { exact: true })).toBeVisible();
      await approvalDrawer.getByRole('button', { name: 'Close run details', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await step('Artifact upload flows into the unified Agent file library', async () => {
      const attachmentsButton = hub.getByRole('button', { name: /^Files \(\d+\)$/ }).first();
      await attachmentsButton.click();
      await hub.locator('input[type="file"]').setInputFiles({
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
      const artifactRow = hub.getByText('agent-ui-evidence.txt', { exact: true }).locator('..').locator('..');
      await artifactRow.getByRole('button', { name: 'Retain', exact: true }).click();
      await expect(artifactRow.getByRole('button', { name: 'Release retention', exact: true })).toBeVisible();
      await captureFunctionalScreenshot(page, 'agent-artifact-library.png', { viewport: { width: 1440, height: 900 } });
    });
  });
});
