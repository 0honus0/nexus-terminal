import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import regressionInputs from '../../fixtures/agent/regression-inputs.json';
import { expect, test as baseTest, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';
import { ensureTestSshConnection } from '../../support/ssh';

const taskPages = new WeakMap<APIRequestContext, Page>();
const test = baseTest.extend<{ _taskPage: void }>({
  _taskPage: [
    async ({ page, request, context }, use) => {
      taskPages.set(request, page);
      taskPages.set(context.request, page);
      await use();
    },
    { auto: true },
  ],
});
test.use({ actionTimeout: 10_000 });

const listenerPid = async (port: number): Promise<number | null> => {
  const localAddress = `0100007F:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  const tcp = await readFile('/proc/net/tcp', 'utf8');
  const inode = tcp
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find((fields) => fields[1] === localAddress && fields[3] === '0A')?.[9];
  if (!inode) return null;

  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let descriptors: string[];
    try {
      descriptors = await readdir(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      try {
        if ((await readlink(`/proc/${entry}/fd/${descriptor}`)) === `socket:[${inode}]`) return Number(entry);
      } catch {
        // The process may close a descriptor while /proc is being inspected.
      }
    }
  }
  return null;
};

const tcpPortOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1_000, () => finish(false));
  });

const prepare = async (request: APIRequestContext) => {
  const page = taskPages.get(request)!;
  await loginAsInitialAdmin(request);
  if (request !== page.request) await loginAsInitialAdmin(page.request);
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
  await page.goto('/settings?tab=agent');
  await page.getByRole('button', { name: 'Add provider', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Model Provider', exact: true });
  const providerName = `Functional regression ${randomUUID()}`;
  await dialog.getByLabel('Display name', { exact: false }).first().fill(providerName);
  await dialog
    .getByLabel('Base URL', { exact: false })
    .first()
    .fill(E2E_URLS.openAiProviderOrigin + '/v1');
  await dialog.getByLabel('Credential', { exact: false }).first().fill('e2e-provider-secret');
  await dialog.getByRole('textbox', { name: 'Model ID *', exact: true }).fill('e2e-model');
  await dialog.getByLabel('Context window', { exact: false }).first().fill('8192');
  await dialog.getByLabel('Maximum output tokens', { exact: false }).first().fill('128');
  const providerResponse = page.waitForResponse(
    (response) => response.url().endsWith('/agent/ai/providers') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save & Add', exact: true }).click();
  const provider = await providerResponse;
  expect(provider.status()).toBe(201);
  const configured = (await provider.json()).data;
  await expect(dialog).toHaveCount(0);
  await page.goto('/connections');
  await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
  const threadResponse = page.waitForResponse(
    (response) => response.url().endsWith('/apps/nexus.agent/threads') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const thread = await threadResponse;
  expect(thread.status()).toBe(201);
  return {
    page,
    providerName,
    headers,
    threadId: (await thread.json()).data.id as string,
    model: { providerId: configured.id, modelId: 'e2e-model', configurationVersion: configured.version },
  };
};

const startTask = async (
  request: APIRequestContext,
  context: Awaited<ReturnType<typeof prepare>>,
  text: string,
  options: {
    connectionIds: number[];
    executionMode?: 'plan' | 'execute';
    expectedStatus?: number;
  } = { connectionIds: [] },
) => {
  const page = context.page;
  // Test targets may be provisioned after Hub initialization; reload the public projection.
  await page.reload();
  await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
  await page
    .getByRole('button')
    .filter({ hasText: `#${context.threadId.slice(-6)}` })
    .click();
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Model', exact: true })
    .getByRole('button')
    .filter({ hasText: context.providerName })
    .click();
  await page.getByRole('button', { name: 'Approval mode', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Approval mode', exact: true })
    .getByRole('button', { name: /Full access/ })
    .click();
  await page.getByRole('button', { name: 'Execution mode', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Execution mode', exact: true })
    .getByRole('button', { name: options.executionMode === 'plan' ? /^Plan only/ : /^Execute/ })
    .click();
  if (options.connectionIds.length) {
    await page.getByRole('button', { name: 'SSH Hosts', exact: true }).click();
    const selection = page.getByRole('dialog', { name: 'SSH Hosts', exact: true }).getByRole('checkbox');
    if (!(await selection.isChecked())) await selection.check();
    await page.getByRole('button', { name: 'SSH Hosts', exact: true }).click();
  }
  await page.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...').fill(text);
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/apps/nexus.agent/runs') && item.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(options.expectedStatus ?? 201);
  return created;
};

const execute = async (
  request: APIRequestContext,
  context: Awaited<ReturnType<typeof prepare>>,
  text: string,
  options: Parameters<typeof startTask>[3] = { connectionIds: [] },
) => {
  const page = context.page;
  const created = await startTask(request, context, text, options);
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
  await expect(page.getByText(textResult!, { exact: true }).last()).toBeVisible();
  return { run, ledger, text: textResult! };
};

test('A08 plan-only deployment reports blocked partial result and cannot execute a proposed SSH mutation', async ({
  request,
}) => {
  const context = await prepare(request);
  const connectionId = await ensureTestSshConnection(request);
  const marker = path.resolve(__dirname, '../../.tmp/ssh-root/blocked-deploy.txt');
  const result = await execute(request, context, `E2E_BLOCKED_DEPLOY connection=${connectionId}`, {
    connectionIds: [connectionId],
    executionMode: 'plan',
  });
  expect(result.run.status).toBe('completed_unverified');
  expect(result.run.needsReconciliation).toBe(false);
  expect(result.run.definition).toMatchObject({ executionMode: 'plan' });
  expect(result.run.definition).not.toHaveProperty('environment');
  const results = result.ledger
    .filter((entry) => entry.kind === 'tool_result')
    .map((entry) => JSON.parse(entry.payload.text!));
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({
    ok: false,
    errorCode: 'PLAN_MODE_TOOL_FORBIDDEN',
    outcome: 'confirmed',
    verification: { status: 'failed' },
  });
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(results[1].ok).toBe(true);
  expect(result.run.plan.items).toEqual([expect.objectContaining({ id: 'deployment', status: 'blocked' })]);
  expect(result.text).toContain('No service was deployed');
  expect(result.text).toContain('Partial result');
  expect(result.text).toContain('unexecuted steps, not success evidence');
});

test('A07 browser rejects stale click then deploys once and delivers a readable PNG Artifact', async ({
  request,
  page,
}) => {
  const context = await prepare(request);
  const contexts = async () =>
    (await (await fetch(`${E2E_URLS.browserControlOrigin}/contexts`)).json()).browserContextIds;
  const baseline = await contexts();
  const state = async () => {
    const response = await fetch(`${E2E_URLS.deploymentPageOrigin}/state`);
    expect(response.ok).toBe(true);
    return response.json();
  };
  expect(await state()).toEqual({ deployed: false, deployments: 0, release: 'fixture-v1' });
  const settings = (await (await request.get('/api/v1/agent/settings')).json()).data;
  const configured = await request.patch('/api/v1/agent/settings', {
    headers: context.headers,
    data: {
      expectedVersion: settings.revision,
      patch: {
        browser: {
          targets: [
            {
              id: 'e2e-deployment',
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
              allowedUrlPatterns: [E2E_URLS.deploymentPageOrigin],
            },
          ],
        },
      },
    },
  });
  expect(configured.ok(), await configured.text()).toBe(true);
  const result = await execute(request, context, `E2E_BROWSER_DEPLOY url=${E2E_URLS.deploymentPageOrigin}/`);
  expect(result.run.needsReconciliation).toBe(false);
  const results = result.ledger
    .filter((entry) => entry.kind === 'tool_result')
    .map((entry) => JSON.parse(entry.payload.text!));
  expect(results[4]).toMatchObject({
    ok: false,
    errorCode: 'BROWSER_NODE_STALE',
    outcome: 'confirmed',
    verification: { status: 'failed' },
  });
  expect(results[2].data.snapshotId).not.toBe(results[3].data.snapshotId);
  expect(JSON.stringify(results[5].data.nodes)).toContain('Not deployed');
  expect(results[6].ok).toBe(true);
  expect(JSON.stringify(results[7].data.nodes)).toContain('Deployed fixture-v1');
  expect(await state()).toEqual({ deployed: true, deployments: 1, release: 'fixture-v1' });
  const capture = results.find((item) => item.data?.type === 'browser_screenshot_capture');
  expect(capture).toMatchObject({
    ok: true,
    data: {
      targetId: 'e2e-deployment',
      url: `${E2E_URLS.deploymentPageOrigin}/`,
      artifact: { mediaType: 'image/png' },
    },
  });
  const artifact = capture.data.artifact;
  expect(result.text).toContain(artifact.id);
  const downloaded = await request.get(`/api/v1/apps/nexus.agent/artifacts/${artifact.id}/content`);
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()['content-type']).toContain('image/png');
  const bytes = await downloaded.body();
  expect(bytes.length).toBe(artifact.sizeBytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  // Decode delivered bytes, rather than treating a PNG signature as a readable image.
  const dimensions = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, bytes.toString('base64'));
  expect(dimensions).toEqual(capture.data.viewport);
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.height).toBeGreaterThan(0);
  expect(results.at(-1)).toMatchObject({ ok: true, summary: 'Browser session closed.' });
  await expect.poll(contexts).toEqual(baseline);
});

test('A06 legacy Workspace Run environment and API are rejected while SSH-only Runs remain available', async ({
  request,
}) => {
  const context = await prepare(request);
  for (const endpoint of [
    '/api/v1/agent/workspace-runtime/availability',
    '/api/v1/agent/workspace-runtime/catalog',
    '/api/v1/apps/nexus.agent/workspaces',
  ]) {
    const response = await request.get(endpoint);
    expect(response.status(), endpoint).toBe(404);
  }

  const createFields = {
    schemaVersion: 1,
    threadId: context.threadId,
    input: { text: 'Do not start an obsolete Workspace environment.', artifactRefs: [] },
    agentDefinitionId: 'agent.default',
    model: context.model,
    approvalMode: 'full_access',
    executionMode: 'execute',
    connectionIds: [],
  };
  for (const environment of [
    null,
    { recipeId: 'workspace-dev', versions: { 'base-tools': '1' }, catalogRevision: 'old' },
  ]) {
    const rejected = await request.post('/api/v1/apps/nexus.agent/runs', {
      headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
      data: { ...createFields, environment },
    });
    expect(rejected.status(), await rejected.text()).toBe(400);
    expect((await rejected.json()).error.code).toBe('VALIDATION_FAILED');
  }
  const runPage = await request.get(`/api/v1/apps/nexus.agent/runs?threadId=${context.threadId}`);
  expect(runPage.ok(), await runPage.text()).toBe(true);
  expect((await runPage.json()).data.items).toHaveLength(0);

  const result = await execute(request, context, 'E2E_NO_WORKSPACE_TOOLS', { connectionIds: [] });
  expect(result.run.definition).not.toHaveProperty('environment');
  expect(result.run.definition).toMatchObject({ connectionIds: [], executionMode: 'execute' });
  expect(result.run.needsReconciliation).toBe(false);
});

for (const useOperationsSkill of [false, true]) {
  test(`${useOperationsSkill ? 'A05 signed Operations Skill' : 'A04 bounded API'} deployment has real endpoints and expires without detached processes`, async ({
    request,
  }) => {
    const context = await prepare(request);
    const connectionId = await ensureTestSshConnection(request);
    const portOwner = net.createServer();
    await new Promise<void>((resolve) => portOwner.listen(0, '127.0.0.1', resolve));
    const address = portOwner.address();
    expect(address && typeof address !== 'string').toBeTruthy();
    const port = (address as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) => portOwner.close((error) => (error ? reject(error) : resolve())));
    const fixture = path.resolve(__dirname, '../../fixtures/agent/task-projects/startup-failure');
    const project = path.resolve(__dirname, '../../.tmp/ssh-root/deploy-api');
    await cp(fixture, project, { recursive: true });
    await writeFile(path.join(project, 'config.json'), '{ "catalogPath": "data/catalog.json" }\n');
    const files = await readdir(project, { recursive: true });
    const baseline = new Map<string, Buffer>();
    for (const file of files) {
      if (['data'].includes(file)) continue;
      baseline.set(file, await readFile(path.join(project, file)));
    }
    try {
      const result = await execute(
        request,
        context,
        `E2E_DEPLOY_API connection=${connectionId} port=${port}${useOperationsSkill ? ' E2E_OPERATIONS_SKILL' : ''}`,
        {
          connectionIds: [connectionId],
        },
      );
      expect(result.run.status).toBe('completed');
      expect(result.run.needsReconciliation).toBe(false);
      const results = result.ledger
        .filter((entry) => entry.kind === 'tool_result')
        .map((entry) => JSON.parse(entry.payload.text!));
      const launch = results.find((item) => item.data?.executionTimeoutSeconds);
      if (useOperationsSkill) {
        expect(results[0]).toMatchObject({ ok: true, data: { matches: [{ id: 'nexus.agent.operations' }] } });
        expect(results[1]).toMatchObject({
          ok: true,
          data: { id: 'nexus.agent.operations', name: 'operations' },
          verification: { status: 'verified' },
        });
        expect(results[1].data.body).toContain('begin with bounded read-only inspection');
        expect(results[1].data.body).toContain('Re-read authoritative state after a change');
        expect(results.indexOf(launch)).toBeGreaterThan(1);
      }
      expect(launch).toMatchObject({
        ok: true,
        data: { status: 'running', executionTimeoutSeconds: 15 },
        verification: { status: 'unverified' },
      });
      expect(results.at(-1)).toMatchObject({ ok: true, data: { jobId: launch.data.jobId, status: 'running' } });
      expect(result.text).toContain(launch.data.jobId);
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });
      const catalog = await fetch(`http://127.0.0.1:${port}/catalog`);
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toEqual(JSON.parse(baseline.get('data/catalog.json')!.toString()));
      const pid = await listenerPid(port);
      expect(pid).not.toBeNull();
      expect(await readlink(`/proc/${pid}/cwd`)).toBe(project);
      expect((await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0')).toContain(`PORT=${port}`);
      for (const [file, bytes] of baseline) expect(await readFile(path.join(project, file))).toEqual(bytes);
      await expect
        .poll(
          async () => {
            try {
              await fetch(`http://127.0.0.1:${port}/health`);
              return 'listening';
            } catch {
              return 'closed';
            }
          },
          { timeout: 20_000 },
        )
        .toBe('closed');
      await expect
        .poll(async () => {
          try {
            await readFile(`/proc/${pid}/cmdline`);
            return 'present';
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            return 'gone';
          }
        })
        .toBe('gone');
    } finally {
      // Keep source available until the bounded process has released its listener even on assertion failure.
      await expect
        .poll(
          async () => {
            try {
              await fetch(`http://127.0.0.1:${port}/health`);
              return false;
            } catch {
              return true;
            }
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      await rm(project, { recursive: true, force: true });
    }
  });
}

test('B02 frontend task repairs gateway 502 without bypassing upstream routing', async ({ page, context }) => {
  const prepared = await prepare(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  const fixture = path.resolve(__dirname, '../../fixtures/agent/task-projects/gateway-502');
  const project = path.resolve(__dirname, '../../.tmp/ssh-root/gateway-502');
  const files = ['AGENTS.md', 'package.json', 'verify.mjs', 'server.mjs', 'config.json', 'data/catalog.json'];
  const baseline = new Map(
    await Promise.all(files.map(async (file) => [file, await readFile(path.join(fixture, file))] as const)),
  );
  await cp(fixture, project, { recursive: true });
  try {
    const response = await startTask(context.request, prepared, `E2E_GATEWAY_502 connection=${connectionId}`, {
      connectionIds: [connectionId],
    });
    expect(response.status()).toBe(201);
    const runId = (await response.json()).data.id;
    await expect(
      page.getByText(
        'Gateway 502 repaired: direct upstream and gateway checks passed; only upstream configuration changed.',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30_000 });
    const run = (await (await context.request.get(`/api/v1/apps/nexus.agent/runs/${runId}`)).json()).data;
    expect(run.status).toBe('completed');
    expect(run.needsReconciliation).toBe(false);
    expect(run.definition.connectionIds).toContain(connectionId);
    const ledger = (
      await (
        await context.request.get(`/api/v1/apps/nexus.agent/threads/${prepared.threadId}/entries?limit=100`)
      ).json()
    ).data.items;
    const results = ledger
      .filter((entry: { kind: string }) => entry.kind === 'tool_result')
      .map((entry: { payload: { text: string } }) => JSON.parse(entry.payload.text));
    expect(results).toHaveLength(4);
    expect(results[1]).toMatchObject({ ok: false, data: { exitCode: 1 } });
    expect(results[1].data.stdout).toContain('"directUpstream":{"status":200');
    expect(results[1].data.stdout).toContain('"requestId":"b02-health","status":502');
    expect(results[1].data.stderr).toContain('"upstreamSocket":"./upstream-wrong.sock","code":"ENOENT"');
    expect(results[3]).toMatchObject({ ok: true, data: { exitCode: 0 }, verification: { status: 'verified' } });
    for (const output of [results[1].data.stdout, results[3].data.stdout]) {
      const identity = JSON.parse(output.split('\n').find((line: string) => line.startsWith('{"serverPid":')));
      await expect(readFile(`/proc/${identity.serverPid}/cmdline`)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(identity.socket)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await tcpPortOpen(identity.port)).toBe(false);
    }
    for (const [file, bytes] of baseline)
      expect(await readFile(path.join(project, file))).toEqual(
        file === 'config.json' ? Buffer.from(bytes.toString().replace('upstream-wrong.sock', 'upstream.sock')) : bytes,
      );
    expect(execFileSync(process.execPath, ['verify.mjs'], { cwd: project, encoding: 'utf8' })).toContain(
      'Direct upstream and gateway health/catalog/404 verified',
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('B01 API 500 repair correlates request and source then preserves data and original HTTP checks', async ({
  request,
}) => {
  const context = await prepare(request);
  const connectionId = await ensureTestSshConnection(request);
  const fixture = path.resolve(__dirname, '../../fixtures/agent/task-projects/api-500');
  const project = path.resolve(__dirname, '../../.tmp/ssh-root/api-500');
  const files = ['AGENTS.md', 'package.json', 'verify.mjs', 'server.mjs', 'data/catalog.json'];
  const baseline = new Map(
    await Promise.all(files.map(async (file) => [file, await readFile(path.join(fixture, file))] as const)),
  );
  await cp(fixture, project, { recursive: true });
  try {
    const result = await execute(request, context, `E2E_API_500_REPAIR connection=${connectionId}`, {
      connectionIds: [connectionId],
    });
    expect(result.run.status).toBe('completed');
    expect(result.run.needsReconciliation).toBe(false);
    const results = result.ledger
      .filter((entry) => entry.kind === 'tool_result')
      .map((entry) => JSON.parse(entry.payload.text!));
    expect(results).toHaveLength(5);
    expect(results[1]).toMatchObject({ ok: false, data: { exitCode: 1 }, verification: { status: 'failed' } });
    expect(results[1].data.stdout).toContain('"requestId":"b01-request-one","status":500');
    expect(results[1].data.stderr).toContain('"requestId":"b01-request-one","path":"/catalog"');
    expect(results[1].data.stderr).toContain('server.mjs:14');
    expect(results[2]).toMatchObject({
      ok: true,
      data: { additions: 1, deletions: 1 },
      verification: { status: 'verified' },
    });
    expect(results[3]).toMatchObject({ ok: true, data: { exitCode: 0 }, verification: { status: 'verified' } });
    expect(results[3].data.stdout).toContain('HTTP health/catalog/404 verified');
    for (const output of [results[1].data.stdout, results[3].data.stdout]) {
      const identity = output.split('\n').find((line: string) => line.startsWith('{"serverPid":'));
      expect(identity).toBeDefined();
      const { serverPid, port } = JSON.parse(identity);
      await expect(readFile(`/proc/${serverPid}/cmdline`)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await tcpPortOpen(port)).toBe(false);
    }
    for (const [file, bytes] of baseline) {
      const expected =
        file === 'server.mjs'
          ? Buffer.from(bytes.toString().replace('catalog.products.map', 'catalog.items.map'))
          : bytes;
      expect(await readFile(path.join(project, file))).toEqual(expected);
    }
    const independent = execFileSync(process.execPath, ['verify.mjs'], { cwd: project, encoding: 'utf8' });
    expect(independent).toContain('"requestId":"b01-request-one","status":200');
    expect(independent).toContain('"requestId":"b01-request-two","status":200');
    expect(independent).toContain('HTTP health/catalog/404 verified');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('A03 build repair preserves original validation and data through a production SSH Run', async ({ request }) => {
  const context = await prepare(request);
  const connectionId = await ensureTestSshConnection(request);
  const fixture = path.resolve(__dirname, '../../fixtures/agent/task-projects/build-failure');
  const project = path.resolve(__dirname, '../../.tmp/ssh-root/build-repair');
  const files = ['AGENTS.md', 'build.mjs', 'verify.mjs', 'package.json', 'data/catalog.json', 'src/catalog.mjs'];
  const baseline = await Promise.all(files.map((file) => readFile(path.join(fixture, file), 'utf8')));
  await cp(fixture, project, { recursive: true });
  try {
    const result = await execute(request, context, `E2E_BUILD_REPAIR connection=${connectionId}`, {
      connectionIds: [connectionId],
    });
    expect(result.run.status).toBe('completed');
    expect(result.run.needsReconciliation).toBe(false);
    const results = result.ledger
      .filter((entry) => entry.kind === 'tool_result')
      .map((entry) => JSON.parse(entry.payload.text!));
    expect(results).toHaveLength(5);
    expect(results[1]).toMatchObject({ ok: false, data: { exitCode: 1 }, verification: { status: 'failed' } });
    expect(results[1].data.stderr).toContain("does not provide an export named 'totalPrice'");
    expect(results[2]).toMatchObject({
      ok: true,
      data: { additions: 1, deletions: 1 },
      verification: { status: 'verified' },
    });
    expect(results[3]).toMatchObject({ ok: true, data: { exitCode: 0 }, verification: { status: 'verified' } });
    expect(results[3].data.stdout).toContain('Catalog build passed.');
    expect(results[3].data.stdout).toContain('Catalog verification passed.');
    expect(results[4].data.sha256).toBe(createHash('sha256').update(baseline[4]!).digest('hex'));
    expect(await readdir(project)).toEqual(['AGENTS.md', 'build.mjs', 'data', 'package.json', 'src', 'verify.mjs']);
    expect(await readdir(path.join(project, 'src'))).toEqual(['catalog.mjs']);
    expect(await readdir(path.join(project, 'data'))).toEqual(['catalog.json']);
    for (const [index, file] of files.entries()) {
      const expected =
        file === 'src/catalog.mjs' ? baseline[index]!.replace('totalPrices', 'totalPrice') : baseline[index]!;
      expect(await readFile(path.join(project, file), 'utf8')).toBe(expected);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('SSH file mutation lifecycle verifies strict patch, move, delete and preserved data through a Run', async ({
  request,
}) => {
  const context = await prepare(request);
  const connectionId = await ensureTestSshConnection(request);
  const project = path.resolve(__dirname, '../../.tmp/ssh-root/file-lifecycle');
  const preserved = '{"business":"keep","version":1}\n';
  await mkdir(project);
  await writeFile(path.join(project, 'preserved.json'), preserved);
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  try {
    const result = await execute(request, context, `E2E_FILE_LIFECYCLE connection=${connectionId}`, {
      connectionIds: [connectionId],
    });
    expect(result.run.status).toBe('completed');
    expect(result.run.needsReconciliation).toBe(false);
    const results = result.ledger
      .filter((entry) => entry.kind === 'tool_result')
      .map((entry) => JSON.parse(entry.payload.text!));
    expect(results).toHaveLength(11);
    expect(results.filter((_, index) => index !== 9).every((item) => item.ok && item.outcome === 'confirmed')).toBe(
      true,
    );
    expect(results[0]).toMatchObject({
      data: { created: true, sha256: digest('alpha\nkeep\n') },
      verification: { status: 'verified' },
    });
    expect(results[1]).toMatchObject({
      data: {
        additions: 1,
        deletions: 1,
        changes: [{ beforeSha256: digest('alpha\nkeep\n'), afterSha256: digest('ALPHA\nkeep\n') }],
      },
      verification: { status: 'verified' },
    });
    for (const index of [2, 5])
      expect(results[index]).toMatchObject({
        data: { content: 'ALPHA\nkeep\n', sha256: digest('ALPHA\nkeep\n') },
        verification: { status: 'verified' },
      });
    expect(results[4]).toMatchObject({
      data: { path: '/file-lifecycle/original.txt', destinationPath: '/file-lifecycle/moved.txt' },
      verification: { status: 'verified' },
    });
    expect(results[7]).toMatchObject({
      data: { path: '/file-lifecycle/moved.txt', deleted: true },
      verification: { status: 'verified' },
    });
    expect(results[9]).toMatchObject({
      ok: false,
      errorCode: 'FILE_PATCH_CONTEXT_MISMATCH',
      verification: { status: 'failed' },
    });
    expect(results[10]).toMatchObject({
      data: { content: preserved, sha256: digest(preserved) },
      verification: { status: 'verified' },
    });
    expect(await readdir(project)).toEqual(['preserved.json']);
    expect(digest(await readFile(path.join(project, 'preserved.json'), 'utf8'))).toBe(digest(preserved));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

for (const persistent of [false, true]) {
  test(`SSH file search cancellation closes a held SFTP read and permits a new request (${persistent ? 'persistent' : 'temporary'})`, async ({
    request,
  }) => {
    const context = await prepare(request);
    const connectionId = await ensureTestSshConnection(request);
    const project = path.resolve(__dirname, '../../.tmp/ssh-root/search-scan');
    await mkdir(project);
    await writeFile(path.join(project, 'sentinel.txt'), 'SCAN_SENTINEL\n');
    const hold = `${E2E_URLS.sshControlOrigin}/sftp/read-hold`;
    try {
      expect((await request.post(`${hold}?blocked=1`)).ok()).toBeTruthy();
      const created = await startTask(
        request,
        context,
        `E2E_SEARCH_SCAN connection=${connectionId}${persistent ? ' persistent' : ''}`,
        { connectionIds: [connectionId] },
      );
      const id = (await created.json()).data.id;
      await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBeGreaterThan(0);
      await context.page.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...').fill('/stop');
      await context.page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect
        .poll(async () => (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data.status)
        .toBe('cancelled');
      await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBe(0);
      expect((await (await request.get(hold)).json()).blocked).toBe(true);
      expect((await request.get(`${E2E_URLS.sshControlOrigin}/health`)).ok()).toBeTruthy();
      await expect
        .poll(async () => {
          const handles = await (await request.get(`${E2E_URLS.sshControlOrigin}/sftp/read-handles`)).json();
          return handles.opened - handles.closed;
        })
        .toBe(0);
      await request.post(`${hold}?blocked=0`);
      const recoveryContext = await prepare(request);
      const recovered = await execute(request, recoveryContext, `E2E_SEARCH_SCAN connection=${connectionId}`, {
        connectionIds: [connectionId],
      });
      const results = recovered.ledger
        .filter((entry) => entry.kind === 'tool_result')
        .map((entry) => JSON.parse(entry.payload.text!));
      expect(results.at(-1)).toMatchObject({
        ok: true,
        data: { matches: [{ path: '/search-scan/sentinel.txt' }], truncated: false },
      });
      expect((await request.get(`${E2E_URLS.sshControlOrigin}/health`)).ok()).toBeTruthy();
    } finally {
      await request.post(`${hold}?blocked=0`);
      await rm(project, { recursive: true, force: true });
    }
  });
}

test('SSH file search reaches a deeply nested real directory without changing files', async ({ request }) => {
  const context = await prepare(request);
  const connectionId = await ensureTestSshConnection(request);
  const project = path.resolve(__dirname, '../../.tmp/ssh-root/search-scan');
  const relative = Array.from({ length: 96 }, () => 'nested').join('/');
  const leaf = path.join(project, relative, 'sentinel.txt');
  await mkdir(path.dirname(leaf), { recursive: true });
  await writeFile(leaf, 'SCAN_SENTINEL\n');
  try {
    const result = await execute(request, context, `E2E_SEARCH_SCAN connection=${connectionId}`, {
      connectionIds: [connectionId],
    });
    expect(result.run.status).toMatch(/^completed/);
    const searchResults = result.ledger
      .filter((entry) => entry.kind === 'tool_result')
      .map((entry) => JSON.parse(entry.payload.text!));
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      ok: true,
      data: {
        scannedFiles: 1,
        scannedBytes: 14,
        truncated: false,
        matches: [{ path: `/search-scan/${relative}/sentinel.txt`, line: 1, text: 'SCAN_SENTINEL' }],
      },
    });
    expect(await readFile(leaf, 'utf8')).toBe('SCAN_SENTINEL\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('SSH file search passes former scan caps and continues after oversized files without following symlinks', async ({
  request,
}) => {
  const context = await prepare(request);
  const connectionId = await ensureTestSshConnection(request);
  const project = path.resolve(__dirname, '../../.tmp/ssh-root/search-scan');
  await mkdir(project);
  try {
    for (let index = 0; index < 2_001; index++)
      await writeFile(path.join(project, `a-${String(index).padStart(4, '0')}.txt`), 'nothing\n');
    const chunk = 'x'.repeat(1024 * 1024 - 1) + '\n';
    for (let index = 0; index < 17; index++) await writeFile(path.join(project, `b-${index}.txt`), chunk);
    await writeFile(path.join(project, 'b-oversized.txt'), 'x'.repeat(1024 * 1024 + 1));
    for (let index = 0; index < 10_001; index++)
      await symlink('z-sentinel.txt', path.join(project, `c-link-${String(index).padStart(5, '0')}`));
    await writeFile(path.join(project, 'z-sentinel.txt'), 'SCAN_SENTINEL\n');
    const result = await execute(request, context, `E2E_SEARCH_SCAN connection=${connectionId}`, {
      connectionIds: [connectionId],
    });
    expect(result.run.status).toMatch(/^completed/);
    const searchResults = result.ledger
      .filter((entry) => entry.kind === 'tool_result')
      .map((entry) => JSON.parse(entry.payload.text!));
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      ok: true,
      data: {
        scannedFiles: 2019,
        truncated: true,
        matches: [{ path: '/search-scan/z-sentinel.txt', line: 1, text: 'SCAN_SENTINEL' }],
      },
    });
    expect(searchResults[0].data.scannedBytes).toBeGreaterThan(16 * 1024 * 1024);
    expect(await readFile(path.join(project, 'z-sentinel.txt'), 'utf8')).toBe('SCAN_SENTINEL\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

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
    const created = await startTask(
      request,
      context,
      `E2E_TASK_A01_READONLY connection=${connectionId}: 接手 /task-a01 项目，说明启动方式、配置要求和启动风险；只读，不修改、不安装、不运行应用。修复属于另一个任务。`,
      { connectionIds: [connectionId] },
    );
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
    await expect(context.page.getByText('catalogPath', { exact: false }).last()).toBeVisible();
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
  const gateNotices = result.ledger.filter(
    (entry) =>
      entry.kind === 'system_notice' &&
      (entry.payload as { reasonCode?: string }).reasonCode === 'COMPLETION_PLAN_INCOMPLETE',
  );
  expect(gateNotices).toHaveLength(1);
  expect(result.run.plan.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'readonly-report', status: 'completed' }),
      expect.objectContaining({ id: 'future-repair', status: 'cancelled' }),
    ]),
  );
  expect(result.run.usage.toolExecutions).toBe(2);
  expect(result.run.needsReconciliation).toBe(false);
});

test('unfinished current work recovers from the completion gate by suspending for input, not cancelling required work', async ({
  request,
}) => {
  const context = await prepare(request);
  const created = await startTask(
    request,
    context,
    'E2E_TASK_GATE_INPUT_RECOVERY: ask me to choose a report format before delivering it.',
  );
  const id = (await created.json()).data.id;
  const readRun = async () => (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data;
  await expect.poll(async () => (await readRun()).status, { timeout: 30_000 }).toBe('awaiting_input');
  const paused = await readRun();
  expect(paused.pendingInputRequest.questions).toEqual([
    expect.objectContaining({ id: 'report_format', kind: 'text' }),
  ]);
  expect(paused.plan.items).toEqual([expect.objectContaining({ id: 'report-format', status: 'blocked' })]);
  expect(paused.usage.toolExecutions).toBe(2);
  await context.page.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...').fill('report_format: concise');
  await context.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(async () => (await readRun()).status, { timeout: 30_000 }).toMatch(/^completed/);
  const resumed = await readRun();
  expect(resumed.id).toBe(id);
  expect(resumed.pendingInputRequest).toBeNull();
  expect(resumed.plan.items).toEqual([expect.objectContaining({ id: 'report-format', status: 'completed' })]);
  expect(resumed.usage.toolExecutions).toBe(3);
  expect(resumed.needsReconciliation).toBe(false);
  const ledger = (
    await (await request.get(`/api/v1/apps/nexus.agent/threads/${context.threadId}/entries?limit=100`)).json()
  ).data.items;
  expect(
    ledger.filter(
      (entry: { kind: string; payload: { reasonCode?: string } }) =>
        entry.kind === 'system_notice' && entry.payload.reasonCode === 'COMPLETION_PLAN_INCOMPLETE',
    ),
  ).toHaveLength(1);
  expect(
    ledger
      .filter((entry: { kind: string }) => entry.kind === 'tool_result')
      .map((entry: { payload: { text: string } }) => JSON.parse(entry.payload.text).ok),
  ).toEqual([true, true, true]);
  expect(
    ledger
      .filter(
        (entry: { kind: string; payload: { text?: string } }) =>
          entry.kind === 'assistant_message' && entry.payload.text,
      )
      .at(-1).payload.text,
  ).toBe('Report format: concise.');
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
    const page = context.page;
    await page.goto('/settings?tab=agent');
    await page.getByRole('button', { name: 'Safety and system', exact: true }).click();
    const memorySection = page
      .getByRole('heading', { name: 'Memory review & publishing', exact: true })
      .locator('xpath=ancestor::section[1]');
    const publishedResponse = page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
    );
    await memorySection.getByRole('button', { name: 'Publish', exact: true }).click();
    const published = await publishedResponse;
    expect(published.ok(), await published.text()).toBeTruthy();
    expect((await published.json()).data).toMatchObject({ status: 'published', version: 2 });
    // Inject a stale client revision while still exercising the UI request/error/reload path.
    await page.route(
      '**' + endpoint,
      async (route) => {
        const body = route.request().postDataJSON();
        await route.continue({ postData: JSON.stringify({ ...body, expectedVersion: 1 }) });
      },
      { times: 1 },
    );
    const staleResponse = page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
    );
    await memorySection.getByRole('button', { name: 'Revoke', exact: true }).click();
    const stale = await staleResponse;
    expect(stale.status(), await stale.text()).toBe(409);
    expect((await stale.json()).error.code).toBe('MEMORY_VERSION_CONFLICT');
    await expect(
      page.getByText('This Memory changed elsewhere. The authoritative version has been reloaded.', { exact: true }),
    ).toBeVisible();
    const revokedResponse = page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
    );
    await memorySection.getByRole('button', { name: 'Revoke', exact: true }).click();
    const revoked = await revokedResponse;
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
  const created = await startTask(context.request, prepared, 'E2E_REGRESSION_CLARIFICATION_UI');
  const runId = (await created.json()).data.id as string;
  await expect
    .poll(
      async () => (await (await context.request.get(`/api/v1/apps/nexus.agent/runs/${runId}`)).json()).data.status,
      { timeout: 30_000 },
    )
    .toBe('awaiting_input');

  await page.goto('/connections');
  await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
  await page.getByText('E2E_REGRESSION_CLARIFICATION_UI', { exact: true }).first().click();
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
