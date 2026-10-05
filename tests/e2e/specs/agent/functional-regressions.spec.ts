import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import regressionInputs from '../../fixtures/agent/regression-inputs.json';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';
import { ensureTestSshConnection } from '../../support/ssh';

const prepare = async (request: APIRequestContext) => {
  await loginAsInitialAdmin(request);
  const csrf = (await (await request.get('/api/v1/agent/security/csrf')).json()).data.token;
  const headers = { 'X-Nexus-CSRF': csrf };
  const installed = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', { headers, data: {} });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  const settings = (await (await request.get('/api/v1/agent/settings')).json()).data;
  const enabled = await request.patch('/api/v1/agent/settings', {
    headers,
    data: {
      expectedVersion: settings.revision,
      patch: { feature: { enabled: true } },
    },
  });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();
  const app = (await (await request.get('/api/v1/agent/apps')).json()).data.find(
    (item: { id: string }) => item.id === 'nexus.agent',
  );
  if (!app.enabled) {
    const active = await request.patch('/api/v1/agent/apps/nexus.agent', {
      headers,
      data: { enabled: true, expectedVersion: app.stateVersion },
    });
    expect(active.ok(), await active.text()).toBeTruthy();
  }
  const provider = await request.post('/api/v1/agent/ai/providers', {
    headers,
    data: {
      kind: 'openai-compatible',
      displayName: 'Functional regression fixture',
      baseUrl: E2E_URLS.openAiProviderOrigin + '/v1',
      protocol: 'chat-completions',
      credential: 'e2e-provider-secret',
      enabled: true,
      models: [{ id: 'e2e-model', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true }],
    },
  });
  expect(provider.status(), await provider.text()).toBe(201);
  const configured = (await provider.json()).data;
  const thread = await request.post('/api/v1/apps/nexus.agent/threads', {
    headers,
    data: { title: 'Data-driven functional regression' },
  });
  expect(thread.status(), await thread.text()).toBe(201);
  return {
    headers,
    threadId: (await thread.json()).data.id as string,
    model: { providerId: configured.id, modelId: 'e2e-model', configurationVersion: configured.version },
  };
};

const execute = async (request: APIRequestContext, context: Awaited<ReturnType<typeof prepare>>, text: string) => {
  const created = await request.post('/api/v1/apps/nexus.agent/runs', {
    headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
    data: {
      schemaVersion: 1,
      threadId: context.threadId,
      input: { text, artifactRefs: [] },
      agentDefinitionId: 'agent.default',
      model: context.model,
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).data.id as string;
  await expect
    .poll(async () => (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data.status, {
      timeout: 30_000,
    })
    .toMatch(/^(completed|completed_unverified|failed|interrupted)$/);
  const run = (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data;
  expect(run.status).toMatch(/^completed/);
  const ledger = (
    await (await request.get(`/api/v1/apps/nexus.agent/threads/${context.threadId}/entries?limit=100`)).json()
  ).data.items as Array<{ kind: string; payload: { text?: string } }>;
  const textResult = ledger.filter((entry) => entry.kind === 'assistant_message' && entry.payload.text).at(-1)
    ?.payload.text;
  expect(textResult).toBeDefined();
  return { run, ledger, text: textResult! };
};

test('A01 read-only project handover reads real files without repairing or starting the application (simulated model, SSH target)', async ({
  request,
}) => {
  const context = await prepare(request);
  const connectionId = await ensureTestSshConnection(request);
  const project = path.resolve(__dirname, '../../.tmp/ssh-root/task-a01');
  const fixture = path.resolve(__dirname, '../../fixtures/agent/task-projects/startup-failure');
  const files = ['AGENTS.md', 'README.md', 'package.json', 'config.json', 'server.mjs', 'data/catalog.json'];
  await mkdir(path.dirname(project), { recursive: true });
  await cp(fixture, project, { recursive: true, errorOnExist: true, force: false });
  try {
    const hashes = await Promise.all(
      files.map(async (file) =>
        createHash('sha256')
          .update(await readFile(path.join(project, file)))
          .digest('hex'),
      ),
    );
    const created = await request.post('/api/v1/apps/nexus.agent/runs', {
      headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
      data: {
        schemaVersion: 1,
        threadId: context.threadId,
        input: {
          text: `E2E_TASK_A01_READONLY connection=${connectionId}: 接手 /task-a01 项目，说明启动方式、配置要求和启动风险；只读，不修改、不安装、不运行应用。修复属于另一个任务。`,
          artifactRefs: [],
        },
        agentDefinitionId: 'agent.default',
        model: context.model,
        approvalMode: 'full_access',
        executionMode: 'execute',
        connectionIds: [connectionId],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).data.id;
    await expect
      .poll(async () => (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data.status, {
        timeout: 30_000,
      })
      .toMatch(/^(completed|completed_unverified|failed|interrupted)$/);
    const run = (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data;
    expect(run.status).toMatch(/^completed/);
    const ledger = (
      await (await request.get(`/api/v1/apps/nexus.agent/threads/${context.threadId}/entries?limit=100`)).json()
    ).data.items;
    const report = JSON.parse(
      ledger
        .filter(
          (entry: { kind: string; payload: { text?: string } }) =>
            entry.kind === 'assistant_message' && entry.payload.text,
        )
        .at(-1).payload.text,
    );
    expect(report).toMatchObject({
      start: 'node server.mjs',
      configKey: 'catalogPath',
      configuredKey: 'catalogFile',
      requiredEnvironment: 'PORT',
      interfaces: ['/health', '/catalog'],
      serviceStarted: false,
    });
    expect(report.files).toEqual(files.map((file, index) => ({ path: `/task-a01/${file}`, sha256: hashes[index] })));
    const toolResults = ledger
      .filter((entry: { kind: string }) => entry.kind === 'tool_result')
      .map((entry: { payload: { text: string } }) => JSON.parse(entry.payload.text));
    expect(toolResults).toHaveLength(6);
    expect(
      toolResults.every((result: { ok: boolean; outcome: string }) => result.ok && result.outcome === 'confirmed'),
    ).toBe(true);
    expect(run.usage.toolExecutions).toBe(6);
    expect(await readdir(project)).toEqual(await readdir(fixture));
    for (const file of files)
      expect(
        createHash('sha256')
          .update(await readFile(path.join(project, file)))
          .digest('hex'),
      ).toBe(hashes[files.indexOf(file)]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('read-only delivery cannot bypass an unfinished future repair plan and can settle it without execution', async ({
  request,
}) => {
  const context = await prepare(request);
  const result = await execute(
    request,
    context,
    'E2E_TASK_READONLY_FUTURE_REPAIR: deliver only a read-only report; future repair needs separate authorization.',
  );
  expect(result.text).toBe('Read-only report delivered. Future repair is not authorized and was not executed.');
  expect(
    result.ledger.some(
      (entry) =>
        entry.kind === 'system_notice' &&
        (entry.payload as { reasonCode?: string }).reasonCode === 'COMPLETION_PLAN_INCOMPLETE',
    ),
  ).toBe(true);
  expect(result.run.plan.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'readonly-report', status: 'completed' }),
      expect.objectContaining({ id: 'future-repair', status: 'cancelled' }),
    ]),
  );
  expect(result.run.usage.toolExecutions).toBe(2);
  expect(result.run.needsReconciliation).toBe(false);
});

test('recorded JSON and marker cases preserve exact output through a later task in the same thread', async ({
  request,
}) => {
  const context = await prepare(request);
  for (const fixture of regressionInputs.modelOutputs) {
    const result = await execute(request, context, fixture.input);
    expect(result.text).toBe(fixture.expected);
    expect(result.run.status).toBe('completed_unverified');
    expect(result.run.usage.toolExecutions).toBe(0);
  }
});

for (const fixture of regressionInputs.memoryProposals) {
  test(`recorded ${fixture.id} traverses the model tool pipeline and optimistic Memory review`, async ({ request }) => {
    const context = await prepare(request);
    const result = await execute(
      request,
      context,
      `E2E_REGRESSION_${fixture.id}: submit one memory candidate with confidence ${fixture.confidence}, then return its id, confidence and status as raw JSON.`,
    );
    const candidate = JSON.parse(result.text) as { id: string; confidence: number; status: string };
    expect(candidate).toMatchObject({ confidence: fixture.confidence, status: 'candidate' });
    expect(candidate.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.run.usage.toolExecutions).toBe(2);
    const proposed = result.ledger
      .filter((entry) => entry.kind === 'tool_result')
      .map((entry) => JSON.parse(entry.payload.text!))
      .filter((entry) => entry.data?.id === candidate.id);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      ok: true,
      outcome: 'confirmed',
      data: { id: candidate.id, confidence: fixture.confidence },
    });
    const endpoint = `/api/v1/apps/nexus.agent/memories/${candidate.id}/review`;
    const published = await request.post(endpoint, {
      headers: context.headers,
      data: { decision: 'publish', expectedVersion: 1 },
    });
    expect(published.ok(), await published.text()).toBeTruthy();
    expect((await published.json()).data).toMatchObject({ status: 'published', version: 2 });
    const stale = await request.post(endpoint, {
      headers: context.headers,
      data: { decision: 'revoke', expectedVersion: 1 },
    });
    expect(stale.status(), await stale.text()).toBe(409);
    expect((await stale.json()).error.code).toBe('MEMORY_VERSION_CONFLICT');
    const revoked = await request.post(endpoint, {
      headers: context.headers,
      data: { decision: 'revoke', expectedVersion: 2 },
    });
    expect(revoked.ok(), await revoked.text()).toBeTruthy();
    expect((await revoked.json()).data).toMatchObject({ status: 'revoked', version: 3 });
    const recallable = (await (await request.get('/api/v1/apps/nexus.agent/memories?status=published')).json()).data
      .items;
    expect(recallable.some((memory: { id: string }) => memory.id === candidate.id)).toBe(false);
  });
}

test('recorded distant deadline rejection returns a precise tool failure without creating a child', async ({
  request,
}) => {
  const context = await prepare(request);
  const result = await execute(
    request,
    context,
    'E2E_REGRESSION_DEADLINE_SENTINEL: attempt one bounded delegation and report its error without retry.',
  );
  expect(JSON.parse(result.text)).toEqual({ errorCode: 'VALIDATION_FAILED' });
  expect(result.run.needsReconciliation).toBe(false);
  const children = await request.get(`/api/v1/apps/nexus.agent/runs/${result.run.id}/subagents?limit=20`);
  expect(children.ok(), await children.text()).toBeTruthy();
  expect((await children.json()).data.items).toHaveLength(0);
});

test('selecting an awaiting-input Run restores its structured clarification snapshot', async ({ page, context }) => {
  const prepared = await prepare(context.request);
  const created = await context.request.post('/api/v1/apps/nexus.agent/runs', {
    headers: { ...prepared.headers, 'Idempotency-Key': randomUUID() },
    data: {
      schemaVersion: 1,
      threadId: prepared.threadId,
      input: { text: 'E2E_REGRESSION_CLARIFICATION_UI', artifactRefs: [] },
      agentDefinitionId: 'agent.default',
      model: prepared.model,
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const runId = (await created.json()).data.id as string;
  await expect
    .poll(
      async () => (await (await context.request.get(`/api/v1/apps/nexus.agent/runs/${runId}`)).json()).data.status,
      { timeout: 30_000 },
    )
    .toBe('awaiting_input');

  await page.goto('/connections');
  await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
  await page.getByText('Data-driven functional regression', { exact: true }).first().click();
  await expect(page.getByText('Choose deployment color', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Green/ }).click();
  await expect(page.locator('#agent-composer')).toHaveValue('deployment_color: green');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect
    .poll(
      async () => (await (await context.request.get(`/api/v1/apps/nexus.agent/runs/${runId}`)).json()).data.status,
      { timeout: 30_000 },
    )
    .toBe('completed_unverified');
  await expect(page.getByText('CHOSEN:green', { exact: true })).toBeVisible();
});
