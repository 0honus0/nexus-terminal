import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
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
  surface: 'builtin' | 'agent' | 'plugin' | 'none';
  stateVersion: number;
  policyRevision: number;
  enabled: boolean;
  health: string;
};
type ProviderView = { id: string; version: number };
type RunView = { id: string; status: string; version: number; definition: { agentDefinitionId: string } };

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
    const response = await request.get(`/api/v1/apps/nexus.developer/runs/${runId}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    latest = ((await response.json()) as Envelope<RunView>).data;
    if (['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'].includes(latest.status))
      return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Preset Agent Run did not reach a terminal state: ${JSON.stringify(latest)}`);
};

const installAndRunDeveloperPreset = async (request: APIRequestContext): Promise<{ threadId: string }> => {
  await loginAsInitialAdmin(request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };

  await step('configure the remote repository without installing a Runner', async () => {
    const before = await request.get('/api/v1/agent/settings');
    expect(before.ok(), await before.text()).toBeTruthy();
    const settings = ((await before.json()) as Envelope<SettingsView>).data;
    const patched = await request.patch('/api/v1/agent/settings', {
      headers,
      data: {
        patch: {
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
    expect(catalog.data.packages).toContainEqual(
      expect.objectContaining({ appId: 'nexus.developer', version: '1.0.0' }),
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
  await step('download, hash-check, signature-verify, and install the remote preset package', async () => {
    const staged = await request.post('/api/v1/agent/plugins/remote/stage', {
      headers,
      data: { repositoryUrl, appId: 'nexus.developer', version: '1.0.0' },
    });
    expect(staged.status(), await staged.text()).toBe(201);
    const stage = (await staged.json()) as Envelope<{
      id: string;
      publisherKeyId: string;
      appId: string;
      version: string;
    }>;
    stageId = stage.data.id;
    expect(stage.data).toMatchObject({ publisherKeyId: publisher.keyId, appId: 'nexus.developer', version: '1.0.0' });

    const verified = await request.post('/api/v1/agent/plugins/verify', { headers, data: { stageId } });
    expect(verified.ok(), await verified.text()).toBeTruthy();
    await expect(verified.json()).resolves.toMatchObject({
      data: {
        plugin: {
          appId: 'nexus.developer',
          version: '1.0.0',
          publisherKeyId: publisher.keyId,
          manifest: { agents: [{ id: 'developer.default', version: '1.0.0' }] },
          skillFiles: ['skills/developer-workflow/SKILL.md'],
        },
      },
    });

    const installed = await request.post('/api/v1/agent/plugins/install', { headers, data: { stageId } });
    expect(installed.status(), await installed.text()).toBe(201);
    await expect(installed.json()).resolves.toMatchObject({
      data: { plugin: { appId: 'nexus.developer', status: 'installed' }, app: { surface: 'agent' } },
    });
  });

  await step('grant only model/run authority and enable the installed preset', async () => {
    const grants = await request.get('/api/v1/agent/apps/nexus.developer/grants');
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
    const replaced = await request.put('/api/v1/agent/apps/nexus.developer/grants', {
      headers,
      data: { capabilities: ['ai.model.use', 'runs.execute'], expectedPolicyRevision: grantView.data.policyRevision },
    });
    expect(replaced.ok(), await replaced.text()).toBeTruthy();

    const app = await appSummary(request, 'nexus.developer');
    const enabled = await request.patch('/api/v1/agent/apps/nexus.developer', {
      headers,
      data: { enabled: true, expectedVersion: app.stateVersion },
    });
    expect(enabled.ok(), await enabled.text()).toBeTruthy();
    await expect(enabled.json()).resolves.toMatchObject({
      data: { id: 'nexus.developer', enabled: true, health: 'healthy', surface: 'agent' },
    });
  });

  let provider!: ProviderView;
  await step('configure a real model provider and make it the preset default', async () => {
    const created = await request.post('/api/v1/agent/ai/providers', {
      headers,
      data: {
        kind: 'openai-compatible',
        displayName: 'Preset E2E Provider',
        baseUrl: providerBase,
        credential: providerSecret,
        models: [{ id: 'e2e-model', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true }],
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
    const definitions = await request.get('/api/v1/apps/nexus.developer/agent-definitions');
    expect(definitions.ok(), await definitions.text()).toBeTruthy();
    await expect(definitions.json()).resolves.toMatchObject({
      data: [{ id: 'developer.default', version: '1.0.0', displayName: 'Developer Agent' }],
    });

    const thread = await request.post('/api/v1/apps/nexus.developer/threads', {
      headers,
      data: { title: 'Preset E2E thread' },
    });
    expect(thread.status(), await thread.text()).toBe(201);
    threadId = ((await thread.json()) as Envelope<{ id: string }>).data.id;
    const created = await request.post('/api/v1/apps/nexus.developer/runs', {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        schemaVersion: 1,
        threadId,
        input: { text: 'Reply with a short confirmation that the Developer Agent is running.', artifactRefs: [] },
        agentDefinitionId: 'developer.default',
        model: { providerId: provider.id, modelId: 'e2e-model', configurationVersion: provider.version },
        connectionIds: [],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const run = ((await created.json()) as Envelope<RunView>).data;
    expect(run.definition.agentDefinitionId).toBe('developer.default');
    const terminal = await waitForTerminalRun(request, run.id);
    expect(['completed', 'completed_unverified']).toContain(terminal.status);
    const ledger = await request.get(`/api/v1/apps/nexus.developer/threads/${threadId}/entries?limit=50`);
    expect(ledger.ok(), await ledger.text()).toBeTruthy();
    expect(JSON.stringify(await ledger.json())).toContain('OK');
  });

  return { threadId };
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

test('remote signed Developer preset installs, registers an Agent definition, and completes a real Run', async ({
  request,
}) => {
  await installAndRunDeveloperPreset(request);
});

test('installed Developer preset uses the host-owned Agent surface and captures functional evidence', async ({
  page,
  context,
}) => {
  const { threadId } = await installAndRunDeveloperPreset(context.request);
  expect(threadId).not.toBe('');
  await step('the installed preset renders through the host-owned generic Agent surface', async () => {
    await page.goto('/connections');
    await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
    const hub = page.locator('section[aria-label="Agent"]');
    await expect(hub).toBeVisible();
    await hub.getByLabel('Agent app', { exact: true }).selectOption('nexus.developer');
    await expect(hub.getByRole('button').filter({ hasText: 'Preset E2E thread' })).toBeVisible();
    await expect(hub.getByText('OK', { exact: true })).toBeVisible();
    await expect(hub.getByText('Agent workspace', { exact: true })).toBeVisible();
    await expect(hub.getByText('Execution state', { exact: true })).toBeVisible();

    const composer = hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...');
    await composer.fill('Confirm the Agent composer can start the next Run from the current thread.');
    await hub.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      hub.getByText('Confirm the Agent composer can start the next Run from the current thread.', { exact: true }),
    ).toBeVisible();
    await expect(hub.getByText('OK', { exact: true })).toHaveCount(2, { timeout: 30_000 });
    await captureFunctionalScreenshot(page, 'agent-developer-preset.png', { viewport: { width: 1440, height: 900 } });

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
