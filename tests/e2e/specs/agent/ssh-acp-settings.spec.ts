import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { addTaskProvider, createTaskThread, sendTask } from '../../fixtures/agent/task-ui';

test.use({ actionTimeout: 10_000 });

for (const decision of ['denied', 'cancelled'] as const) {
  test(`SSH ACP settings product chain: ${decision} inner permission without a Workspace profile`, async ({
    page,
    context,
  }) => {
    const request = context.request;
    await loginAsInitialAdmin(request);
    await setUiLanguage(request);
    const csrf = (await (await request.get('/api/v1/agent/security/csrf')).json()).data.token;
    const headers = { 'X-Nexus-CSRF': csrf };
    const connectionId = await ensureTestSshConnection(request);
    const directory = path.resolve(__dirname, '../../.tmp/ssh-root/acp execution');
    await mkdir(directory, { recursive: true });
    const evidencePath = path.join(directory, 'protocol.jsonl');
    const argv = [process.execPath, path.resolve(__dirname, '../../fixtures/agent/acp-process.mjs'), evidencePath];
    const installed = await request.post('/api/v1/agent/onboarding/recommended-plugin/install', { headers, data: {} });
    expect(installed.ok(), await installed.text()).toBeTruthy();
    const settings = (await (await request.get('/api/v1/agent/settings')).json()).data;
    const configured = await request.patch('/api/v1/agent/settings', {
      headers,
      data: {
        expectedVersion: settings.revision,
        patch: { feature: { enabled: true }, workspaceRuntime: { acpProfiles: [] } },
      },
    });
    expect(configured.ok(), await configured.text()).toBeTruthy();
    await page.goto('/settings?tab=agent');
    const panel = page.locator('#settings-panel-agent');
    await panel.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
    const section = panel
      .getByRole('heading', { name: 'ACP Integrations', exact: true })
      .locator('xpath=ancestor::section[1]');
    await section.getByRole('button', { name: 'Add integration', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add ACP Integration', exact: true });
    await dialog.getByRole('textbox', { name: 'Display name' }).fill('SSH ACP settings fixture');
    await expect(dialog.getByRole('button', { name: 'Save & Add', exact: true })).toBeEnabled();
    await expect(dialog.getByText('SSH', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Execution target type', exact: true })).toHaveCount(0);
    await dialog
      .getByRole('textbox', { name: 'SSH argv (JSON array; use env for environment variables)', exact: true })
      .fill(JSON.stringify(argv));
    await dialog.getByRole('textbox', { name: 'SSH working directory (absolute path)', exact: true }).fill(directory);
    await dialog.getByRole('button', { name: 'Save & Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    const row = section.locator('article').filter({ hasText: 'SSH ACP settings fixture' });
    await expect(row).toContainText(`SSH · ${directory}`);
    await expect(row.getByRole('combobox')).toHaveCount(0);
    const listed = await request.get('/api/v1/apps/nexus.agent/integrations?kind=acp');
    expect(listed.ok(), await listed.text()).toBeTruthy();
    const integration = (await listed.json()).data.find(
      (item: { configuration: { displayName: string } }) =>
        item.configuration.displayName === 'SSH ACP settings fixture',
    );
    expect(integration).toMatchObject({
      enabled: true,
      configuration: {
        transport: 'ssh',
        argv,
        cwd: directory,
        protocolVersion: '1',
      },
    });
    const invalid = await request.patch(`/api/v1/apps/nexus.agent/integrations/${integration.id}`, {
      headers,
      data: {
        kind: 'acp',
        enabled: true,
        expectedVersion: integration.version,
        configuration: { ...integration.configuration, cwd: 'relative/path' },
      },
    });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'ACP_SSH_CONFIGURATION_INVALID' } });
    await page.reload();
    await panel.getByRole('button', { name: 'Runtime & Environments', exact: true }).click();
    await expect(row).toContainText(`SSH · ${directory}`);
    const configuredProvider = await addTaskProvider(page, 'ACP product chain fixture');
    const thread = await createTaskThread(page);
    expect(thread.status(), await thread.text()).toBe(201);
    const threadId = (await thread.json()).data.id;
    const created = await sendTask(page, {
      schemaVersion: 1,
      threadId,
      input: { text: `E2E_ACP_EXECUTE connection=${connectionId} integration=${integration.id}`, artifactRefs: [] },
      agentDefinitionId: 'agent.default',
      model: {
        providerId: configuredProvider.id,
        modelId: 'e2e-model',
        configurationVersion: configuredProvider.version,
      },
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [connectionId],
    });
    expect(created.status(), await created.text()).toBe(201);
    const runId = (await created.json()).data.id;
    const readRun = async () => (await (await request.get(`/api/v1/apps/nexus.agent/runs/${runId}`)).json()).data;
    const evidence = async () =>
      (await readFile(evidencePath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    try {
      let approval: { id: string; version: number; operationHash: string; inspection: { toolName: string } };
      await expect
        .poll(async () => {
          const approvals = (await (await request.get(`/api/v1/apps/nexus.agent/runs/${runId}/approvals`)).json()).data;
          approval = approvals.find((item: { status: string }) => item.status === 'requested');
          return approval?.inspection.toolName;
        })
        .toBe('acp_inner_permission');
      const before = await evidence();
      expect(before.filter((item) => item.event === 'request').map((item) => item.method)).toEqual([
        'initialize',
        'session/new',
        'session/prompt',
      ]);
      expect(before.find((item) => item.event === 'started').cwd).toBe(directory);
      expect(before.some((item) => item.event === 'permission')).toBe(false);
      const pid = before.find((item) => item.event === 'started').pid;
      const processGone = () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
          throw error;
        }
      };
      if (decision === 'cancelled') {
        await page.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...').fill('/stop');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect.poll(async () => (await readRun()).status).toBe('interrupted');
        await expect.poll(async () => (await evidence()).some((item) => item.event === 'exited')).toBe(true);
        await expect.poll(processGone).toBe(true);
        const late = await request.post(`/api/v1/apps/nexus.agent/approvals/${approval!.id}/resolve`, {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: {
            schemaVersion: 1,
            expectedVersion: approval!.version,
            operationHash: approval!.operationHash,
            decision: 'approved',
          },
        });
        expect(late.status()).toBe(409);
        const entries = (
          await (await request.get(`/api/v1/apps/nexus.agent/threads/${threadId}/entries?limit=100`)).json()
        ).data.items;
        const result = entries.find(
          (entry: { kind: string; payload: { toolCallId?: string } }) =>
            entry.kind === 'tool_result' && entry.payload.toolCallId === 'call_acp_execute',
        );
        expect(JSON.parse(result.payload.text)).toMatchObject({
          ok: false,
          outcome: 'unknown',
          errorCode: 'ABORTED',
          verification: { status: 'failed' },
        });
        const recorded = await evidence();
        expect(recorded.filter((item) => item.event === 'started')).toHaveLength(1);
        expect(recorded.some((item) => item.event === 'permission' && item.result?.outcome?.optionId === 'allow')).toBe(
          false,
        );
        await expect(stat(evidencePath + '.forbidden')).rejects.toMatchObject({ code: 'ENOENT' });
        return;
      }
      const denied = await request.post(`/api/v1/apps/nexus.agent/approvals/${approval!.id}/resolve`, {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          schemaVersion: 1,
          expectedVersion: approval!.version,
          operationHash: approval!.operationHash,
          decision: 'denied',
        },
      });
      expect(denied.ok(), await denied.text()).toBeTruthy();
      await expect.poll(async () => (await readRun()).status).toBe('completed');
      await expect.poll(async () => (await evidence()).some((item) => item.event === 'exited')).toBe(true);
      await expect.poll(processGone).toBe(true);
      const recorded = await evidence();
      expect(recorded.filter((item) => item.event === 'started')).toHaveLength(1);
      expect(recorded.find((item) => item.event === 'permission').result).toEqual({
        outcome: { outcome: 'selected', optionId: 'reject' },
      });
      await expect(stat(evidencePath + '.forbidden')).rejects.toMatchObject({ code: 'ENOENT' });
      const entries = (
        await (await request.get(`/api/v1/apps/nexus.agent/threads/${threadId}/entries?limit=100`)).json()
      ).data.items;
      const results = entries
        .filter((entry: { kind: string }) => entry.kind === 'tool_result')
        .map((entry: { payload: { text: string } }) => JSON.parse(entry.payload.text));
      expect(
        results.find((result: { data?: { stopReason?: string } }) => result.data?.stopReason === 'end_turn'),
      ).toMatchObject({
        ok: true,
        data: { text: 'ACP_INNER_REJECTED', stopReason: 'end_turn' },
        verification: { status: 'unverified' },
      });
      expect(results.at(-1)).toMatchObject({ ok: true, verification: { status: 'verified' } });
    } finally {
      const current = await readRun();
      if (!['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'].includes(current.status)) {
        const cancelled = await request.post(`/api/v1/apps/nexus.agent/runs/${runId}/cancel`, {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: { schemaVersion: 1, expectedVersion: current.version },
        });
        expect(cancelled.ok(), await cancelled.text()).toBeTruthy();
        await expect.poll(async () => (await readRun()).status).toMatch(/^(cancelled|interrupted)$/);
      }
      await rm(directory, { recursive: true, force: true });
      const removed = await request.delete(
        `/api/v1/apps/nexus.agent/integrations/${integration.id}?expectedVersion=${integration.version}`,
        { headers },
      );
      expect(removed.ok(), await removed.text()).toBeTruthy();
    }
  });
}
