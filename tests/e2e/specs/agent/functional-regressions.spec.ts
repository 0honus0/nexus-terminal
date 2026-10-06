import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
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

const execute = async (
  request: APIRequestContext,
  context: Awaited<ReturnType<typeof prepare>>,
  text: string,
  options: {
    connectionIds: number[];
    environment?: { recipeId: string; versions: Record<string, string>; catalogRevision: string };
  } = { connectionIds: [] },
) => {
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
      connectionIds: options.connectionIds,
      ...(options.environment ? { environment: options.environment } : {}),
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

test('A06 frozen environment rejects overrides and stale Catalog then executes a real Workspace Job', async ({
  request,
}) => {
  const context = await prepare(request);
  const catalog = (await (await request.get('/api/v1/agent/workspace-runtime/catalog')).json()).data;
  const environment = { recipeId: 'workspace-dev', versions: { 'base-tools': '1' }, catalogRevision: catalog.revision };
  const settings = (await (await request.get('/api/v1/agent/settings')).json()).data;
  const configured = await request.patch('/api/v1/agent/settings', {
    headers: context.headers,
    data: {
      expectedVersion: settings.revision,
      patch: {
        workspaceRuntime: {
          enabledRecipeIds: ['workspace-dev'],
          toolVersions: { 'base-tools': { enabledVersionIds: ['1'], defaultVersionId: '1' } },
        },
      },
    },
  });
  expect(configured.ok(), await configured.text()).toBe(true);
  const stale = await request.post('/api/v1/apps/nexus.agent/runs', {
    headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
    data: {
      schemaVersion: 1,
      threadId: context.threadId,
      input: { text: 'E2E_FROZEN_ENVIRONMENT', artifactRefs: [] },
      agentDefinitionId: 'agent.default',
      model: context.model,
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [],
      environment: { ...environment, catalogRevision: 'stale-catalog' },
    },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error.code).toBe('CATALOG_REVISION_CONFLICT');
  const result = await execute(request, context, 'E2E_FROZEN_ENVIRONMENT', { connectionIds: [], environment });
  const results = result.ledger
    .filter((entry) => entry.kind === 'tool_result')
    .map((entry) => JSON.parse(entry.payload.text!));
  expect(results[0]).toMatchObject({ ok: false, errorCode: 'TOOL_ARGUMENTS_INVALID' });
  const created = results.find((item) => item.data?.recipeId);
  expect(created).toMatchObject({ ok: true, data: { recipeId: 'workspace-dev', generation: 1, status: 'ready' } });
  const id = created.data.workspaceId;
  const workspacePath = `/api/v1/apps/nexus.agent/workspaces/${id}`;
  try {
    const workspace = (await (await request.get(workspacePath)).json()).data;
    expect(workspace).toMatchObject({ runId: result.run.id, generation: 1, status: 'stopped' });
    expect(workspace.profile).toEqual(result.run.definition.environment);
    expect(workspace.profile.toolchain).toEqual([{ familyId: 'base-tools', versionId: '1' }]);
    const execution = results.find((item) => item.data?.jobId);
    expect(execution).toMatchObject({ ok: true, verification: { status: 'verified' } });
    const jobResponse = await fetch(
      `http://127.0.0.1:${process.env.NEXUS_E2E_AGENT_RUNNER_PORT ?? '29095'}/v1/jobs/${execution.data.jobId}`,
      {
        headers: {
          Authorization: 'Bearer e2e-isolated-runner-token-not-for-production-00000000',
          'X-Nexus-Agent-Protocol': '2026-09-13',
        },
      },
    );
    expect(jobResponse.ok).toBe(true);
    const job = await jobResponse.json();
    expect(job).toMatchObject({
      workspaceId: id,
      generation: 1,
      status: 'succeeded',
      result: { exitCode: 0, timedOut: false },
    });
    expect(job.result.stdout).toContain('frozen-environment-ready\n');
    const cwd = job.result.stdout.trim().split('\n').at(-1);
    expect(cwd).toContain(`/runtime/workspaces/${id}/core/workspace/work`);
    expect(await readdir(cwd)).toEqual([]);
  } finally {
    const workspace = (await (await request.get(workspacePath)).json()).data;
    const deleted = await request.post(workspacePath + '/actions', {
      headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
      data: { schemaVersion: 1, expectedVersion: workspace.version, action: 'delete' },
    });
    expect(deleted.status()).toBe(202);
    const command = (await deleted.json()).data;
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/v1/apps/nexus.agent/workspace-runtime/commands/${command.id}`)).json()).data
            .status,
      )
      .toBe('succeeded');
    expect((await (await request.get(workspacePath)).json()).data.status).toBe('deleted');
  }
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
      const listener = execFileSync('ss', ['-ltnp', `sport = :${port}`], { encoding: 'utf8' });
      expect(listener).toContain(`127.0.0.1:${port}`);
      const pid = listener.match(/pid=(\d+)/)?.[1];
      expect(pid).toBeDefined();
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
      const created = await request.post('/api/v1/apps/nexus.agent/runs', {
        headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          threadId: context.threadId,
          input: {
            text: `E2E_SEARCH_SCAN connection=${connectionId}${persistent ? ' persistent' : ''}`,
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
      await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBeGreaterThan(0);
      const run = (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data;
      const cancelled = await request.post(`/api/v1/apps/nexus.agent/runs/${id}/cancel`, {
        headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
        data: { schemaVersion: 1, expectedVersion: run.version },
      });
      expect(cancelled.ok(), await cancelled.text()).toBeTruthy();
      await expect
        .poll(async () => (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data.status)
        .toBe('cancelled');
      await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBe(0);
      expect((await (await request.get(hold)).json()).blocked).toBe(true);
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
  const created = await request.post('/api/v1/apps/nexus.agent/runs', {
    headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
    data: {
      schemaVersion: 1,
      threadId: context.threadId,
      input: {
        text: 'E2E_TASK_GATE_INPUT_RECOVERY: ask me to choose a report format before delivering it.',
        artifactRefs: [],
      },
      agentDefinitionId: 'agent.default',
      model: context.model,
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).data.id;
  const readRun = async () => (await (await request.get(`/api/v1/apps/nexus.agent/runs/${id}`)).json()).data;
  await expect.poll(async () => (await readRun()).status, { timeout: 30_000 }).toBe('awaiting_input');
  const paused = await readRun();
  expect(paused.pendingInputRequest.questions).toEqual([
    expect.objectContaining({ id: 'report_format', kind: 'text' }),
  ]);
  expect(paused.plan.items).toEqual([expect.objectContaining({ id: 'report-format', status: 'blocked' })]);
  expect(paused.usage.toolExecutions).toBe(2);
  const answered = await request.post(`/api/v1/apps/nexus.agent/runs/${id}/inputs`, {
    headers: { ...context.headers, 'Idempotency-Key': randomUUID() },
    data: { schemaVersion: 1, expectedVersion: paused.version, text: 'report_format: concise', artifactRefs: [] },
  });
  expect(answered.status(), await answered.text()).toBe(202);
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
