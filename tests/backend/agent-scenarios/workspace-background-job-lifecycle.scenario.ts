import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal } from '../../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../../packages/agent-runner/src/controller/server';
import { registerShellToolContributions } from '../../../packages/backend/src/bootstrap/agent/tool-contributions';
import { RunnerHttpAdapter } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter';
import { WorkspaceShellTargetAdapter } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/workspace-shell-target.adapter';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { ShellCapabilityService } from '../../../packages/backend/src/modules/agent/capabilities/shell-capability.service';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { modelFacingToolSchemas } from '../../../packages/backend/src/modules/agent/capabilities/tool-model-surface';
import { PolicyService } from '../../../packages/backend/src/modules/agent/capabilities/policy.service';
import { AgentTargetResolver } from '../../../packages/backend/src/modules/agent/capabilities/target-resolver';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import type { AgentWorkspaceRepositoryPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type { WorkspaceRuntimeGatewayPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import { createUnifiedShellTools } from '../../../packages/backend/src/modules/agent/tools/host/shell-tools';
import { completionGateDecision } from '../../../packages/backend/src/modules/agent/runtime/execution/completion-gate';
import { scope } from './scenario-fixtures';

export const workspaceBackgroundJobLifecycleScenario = async () => {
  const catalog = new ToolCatalog();
  registerShellToolContributions({
    catalog,
    shell: null!,
    cryptoHash: {
      sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
    },
  });
  const descriptors = new Map(catalog.list(scope).map((descriptor) => [descriptor.name, descriptor]));
  const execute = descriptors.get('shell_execute');
  assert.ok(execute, 'canonical shell_execute must remain registered');
  const executeSchema = execute.inputSchema as {
    properties?: { mode?: { enum?: unknown[] } };
  };
  assert.deepEqual(
    executeSchema.properties?.mode?.enum,
    ['foreground', 'background'],
    'canonical Workspace execution must explicitly choose foreground/background execution',
  );
  assert.equal(
    descriptors.get('shell_job')?.riskClass,
    'control',
    'canonical Shell must expose one bounded shell_job lifecycle control Tool',
  );
  const planNames = new Set(
    modelFacingToolSchemas(
      catalog,
      scope,
      {
        environment: {
          kind: 'code',
          recipeId: 'scenario-code',
          recipeRevision: '1',
          runtimeDigest: 'scenario-runtime',
          catalogRevision: 'scenario-catalog',
          toolchain: [],
          runnerPlugins: [],
          acpProfiles: [],
          browserTarget: null,
        },
      },
      'plan',
    ).map((tool) => tool.name),
  );
  assert.equal(planNames.has('shell_job'), true, 'durable job status/wait control should remain plan-visible');
  assert.equal(planNames.has('shell_execute'), false, 'plan mode must still hide command mutation');

  const toolWorkspace = {
    ...scope,
    id: 'background-workspace',
    runId: 'background-run',
    agentRuntimeId: 'background-runtime',
    retained: false,
    profile: {
      kind: 'code' as const,
      recipeId: 'scenario-code',
      recipeRevision: '1',
      runtimeDigest: 'scenario-runtime',
      catalogRevision: 'scenario-catalog',
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    },
    generation: 7,
    status: 'running' as const,
    retainedManifestRef: null,
    version: 2,
    lastActiveAt: 1_800_000_000,
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_000,
  };
  const toolRepository = {
    getWorkspace: async () => toolWorkspace,
  } as unknown as AgentWorkspaceRepositoryPort;
  const runningJob = {
    jobId: 'job-' + 'e'.repeat(64),
    workspaceId: toolWorkspace.id,
    generation: toolWorkspace.generation,
    status: 'running' as const,
    result: null,
    error: null,
    createdAt: 1_800_000_000,
    completedAt: null,
  };
  const succeededJob = {
    ...runningJob,
    status: 'succeeded' as const,
    result: {
      exitCode: 0,
      signal: null,
      stdout: 'verified\n',
      stderr: '',
      truncated: false,
      timedOut: false,
    },
    completedAt: 1_800_000_010,
  };
  const cancelledJob = {
    ...runningJob,
    status: 'cancelled' as const,
    error: 'WORKSPACE_JOB_CANCELLED',
    completedAt: 1_800_000_005,
  };
  const toolGateway: WorkspaceRuntimeGatewayPort = {
    startJob: async () => runningJob,
    invoke: async () => succeededJob,
    queryJob: async () => runningJob,
    waitJob: async () => succeededJob,
    cancelJob: async () => cancelledJob,
  };
  const toolCrypto = {
    sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
  };
  const toolContext: ToolContext = {
    ...scope,
    actor: {
      kind: 'agent',
      userId: scope.userId,
      appId: scope.appId,
      runId: toolWorkspace.runId,
      agentRuntimeId: toolWorkspace.agentRuntimeId,
    },
    runId: toolWorkspace.runId,
    agentRuntimeId: toolWorkspace.agentRuntimeId,
    connectionIds: [],
    environment: toolWorkspace.profile,
    stepId: 'background-step',
    signal: new AbortController().signal,
    deadlineAt: 1_800_500_000,
    maxOutputBytes: 64 * 1024,
    inputRevision: 2,
  };
  const shellTargets = new AgentTargetResolver(toolRepository, null!, toolCrypto);
  const workspaceShellTarget = new WorkspaceShellTargetAdapter(toolRepository, toolGateway);
  const shellService = new ShellCapabilityService(shellTargets, workspaceShellTarget, null!, toolCrypto);
  const shellTools = new Map(
    createUnifiedShellTools(shellService, toolCrypto).map((tool) => [tool.descriptor.name, tool]),
  );
  const executeTool = shellTools.get('shell_execute');
  const controlTool = shellTools.get('shell_job');
  assert.ok(executeTool && controlTool);
  const backgroundInspection = await executeTool.inspect(
    {
      target: 'workspace',
      id: toolWorkspace.id,
      command: { kind: 'argv', argv: ['pnpm', 'test'] },
      mode: 'background',
      timeoutSeconds: 60,
    },
    toolContext,
    7,
  );
  assert.equal(backgroundInspection.risk, 'mutate');
  assert.equal(backgroundInspection.mutation, true);
  assert.equal(new PolicyService().decide(backgroundInspection, 7).action, 'requireApproval');
  const backgroundLaunch = await executeTool.execute(backgroundInspection, toolContext);
  assert.equal(backgroundLaunch.ok, true);
  assert.equal(backgroundLaunch.outcome, 'confirmed');
  assert.equal(
    backgroundLaunch.verification.status,
    'unverified',
    'background launch confirms durable acceptance, not command completion',
  );
  const missingModeArguments = { ...(backgroundInspection.normalizedArguments as Record<string, JsonValue>) };
  delete missingModeArguments.mode;
  await assert.rejects(
    () => executeTool.execute({ ...backgroundInspection, normalizedArguments: missingModeArguments }, toolContext),
    /TOOL_ARGUMENTS_INVALID/,
    'durable argv inspections without the canonical mode field must fail closed',
  );

  const waitInspection = await controlTool.inspect(
    { target: 'workspace', id: toolWorkspace.id, jobId: runningJob.jobId, action: 'wait', waitSeconds: 60 },
    toolContext,
    7,
  );
  assert.equal(waitInspection.risk, 'control');
  assert.equal(waitInspection.mutation, false);
  assert.equal(new PolicyService().decide(waitInspection, 7).action, 'allow');
  const waitedToolResult = await controlTool.execute(waitInspection, toolContext);
  assert.equal(waitedToolResult.ok, true);
  assert.equal(
    waitedToolResult.verification.status,
    'verified',
    'only terminal zero-exit durable job evidence is verified',
  );
  const cancelInspection = await controlTool.inspect(
    { target: 'workspace', id: toolWorkspace.id, jobId: runningJob.jobId, action: 'cancel' },
    toolContext,
    7,
  );
  const cancelledToolResult = await controlTool.execute(cancelInspection, toolContext);
  assert.equal(cancelledToolResult.ok, true, 'confirmed cancellation means the control action succeeded');
  assert.equal(
    cancelledToolResult.verification.status,
    'failed',
    'cancelled commands must never count as successful execution evidence',
  );
  const completionRun = {
    definition: { executionMode: 'execute' },
    plan: { items: [] },
  } as Parameters<typeof completionGateDecision>[0];
  const backgroundOnlyEvidence = {
    tools: [
      {
        toolName: 'shell_execute',
        stepIndex: 1,
        inspection: backgroundInspection,
        result: backgroundLaunch,
      },
    ],
    readyEvidenceRefs: [],
    gateBlocksSinceToolProgress: 0,
  } as Parameters<typeof completionGateDecision>[1];
  const backgroundOnlyDecision = completionGateDecision(
    completionRun,
    backgroundOnlyEvidence,
    'Run tests before completing.',
  );
  assert.equal(
    backgroundOnlyDecision.kind,
    'continue',
    'background job acceptance alone must not satisfy requested execution verification',
  );
  const terminalEvidence = {
    ...backgroundOnlyEvidence,
    tools: [
      ...backgroundOnlyEvidence.tools,
      {
        toolName: 'shell_job',
        stepIndex: 2,
        inspection: waitInspection,
        result: waitedToolResult,
      },
    ],
  } as Parameters<typeof completionGateDecision>[1];
  assert.deepEqual(completionGateDecision(completionRun, terminalEvidence, 'Run tests before completing.'), {
    kind: 'complete',
    terminalStatus: 'completed',
    summary: 'Verified execution evidence satisfied the requested completion check.',
  });

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-workspace-background-job-'));
  const journal = new RunnerJournal(path.join(directory, 'journal.json'));
  journal.saveWorkspace({
    workspaceId: 'background-workspace',
    generation: 7,
    status: 'running',
    retained: false,
    toolchain: [],
    runnerPlugins: [],
    acpProfiles: [],
    browserTarget: null,
  });
  const pending = new Map<
    string,
    {
      resolve: (value: {
        exitCode: number | null;
        signal: string | null;
        stdout: string;
        stderr: string;
        truncated: boolean;
        timedOut: boolean;
      }) => void;
      reject: (error: Error) => void;
    }
  >();
  let cancelCalls = 0;
  let patchCalls = 0;
  const runtimeEngine = {
    executeJob: (request: { jobId: string; argv: string[] }) =>
      new Promise<{
        exitCode: number | null;
        signal: string | null;
        stdout: string;
        stderr: string;
        truncated: boolean;
        timedOut: boolean;
      }>((resolve, reject) => {
        pending.set(request.jobId, { resolve, reject });
        if (request.argv[0] === 'complete-later') {
          setTimeout(() => {
            const current = pending.get(request.jobId);
            if (!current) return;
            pending.delete(request.jobId);
            current.resolve({
              exitCode: 0,
              signal: null,
              stdout: 'done\n',
              stderr: '',
              truncated: false,
              timedOut: false,
            });
          }, 30);
        }
      }),
    cancelJob: (jobId: string) => {
      const current = pending.get(jobId);
      if (!current) return false;
      pending.delete(jobId);
      cancelCalls += 1;
      current.reject(new Error('WORKSPACE_JOB_CANCELLED'));
      return true;
    },
    applyWorkspacePatch: () => {
      patchCalls += 1;
      return { changes: [], applied: true };
    },
  };
  const server = new RunnerControllerServer({
    token: 'background-token',
    journal,
    runtimeEngine,
    catalog: {},
    installer: {},
    storage: {},
    cleanup: {},
    pluginRunner: {},
    acpRuntime: { closeAll: () => undefined },
    terminalRuntime: { closeAll: () => undefined },
    browserTunnel: { closeAll: () => undefined },
  } as unknown as ConstructorParameters<typeof RunnerControllerServer>[0]).createServer();

  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('SCENARIO_RUNNER_ADDRESS_INVALID'));
          return;
        }
        resolve('http://127.0.0.1:' + address.port);
      });
    });
    const adapter = new RunnerHttpAdapter(baseUrl, 'background-token');
    const call = (operationChar: string, argv: string[]) => ({
      operationHash: 'v1:' + operationChar.repeat(64),
      argv,
      cwd: '/workspace/work',
      maxBytes: 8 * 1024,
      timeoutMs: 2_000,
    });

    let queryCalls = 0;
    const originalQueryJob = adapter.queryJob.bind(adapter);
    adapter.queryJob = async (jobId, signal) => {
      queryCalls += 1;
      return originalQueryJob(jobId, signal);
    };
    const foreground = await adapter.invoke(
      { workspaceId: 'background-workspace', generation: 7 },
      call('a', ['complete-later']),
      new AbortController().signal,
    );
    assert.equal(foreground.status, 'succeeded');
    assert.equal(foreground.result?.stdout, 'done\n');
    assert.equal(queryCalls, 0, 'foreground invoke must use Runner server-side wait instead of Backend GET polling');
    const foregroundQueryCalls = queryCalls;

    const background = await adapter.startJob(
      { workspaceId: 'background-workspace', generation: 7 },
      call('b', ['hold']),
      new AbortController().signal,
    );
    assert.equal(background.status, 'running', 'background start must return before terminal completion');

    await assert.rejects(
      () =>
        adapter.startJob(
          { workspaceId: 'background-workspace', generation: 7 },
          call('c', ['second']),
          new AbortController().signal,
        ),
      /WORKSPACE_JOB_ACTIVE_CONFLICT/,
      'one active argv job per Workspace generation must protect the background single-writer boundary',
    );

    const patchConflict = await fetch(baseUrl + '/v1/workspaces/background-workspace/coding/apply-patch', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer background-token',
        'Content-Type': 'application/json',
        'X-Nexus-Agent-Protocol': '2026-09-13',
      },
      body: JSON.stringify({
        generation: 7,
        patch: 'bounded-test-patch',
        expectedFiles: [],
      }),
    });
    assert.equal(patchConflict.status, 409);
    assert.equal(patchCalls, 0, 'active background jobs must block actual incremental patch mutation');

    const cancelled = await adapter.cancelJob(background.jobId, new AbortController().signal);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelCalls, 1);
    const cancelledAgain = await adapter.queryJob(background.jobId);
    assert.equal(cancelledAgain.status, 'cancelled', 'cancelled must be durable in the existing Runner job journal');

    const waiting = await adapter.startJob(
      { workspaceId: 'background-workspace', generation: 7 },
      call('d', ['complete-later']),
      new AbortController().signal,
    );
    assert.equal(waiting.status, 'running');
    const waited = await adapter.waitJob(waiting.jobId, 1_000, new AbortController().signal);
    assert.equal(waited.status, 'succeeded');
    assert.equal(waited.result?.stdout, 'done\n');

    journal.saveWorkspace({
      workspaceId: 'background-workspace',
      generation: 8,
      status: 'running',
      retained: false,
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    });
    const oldGeneration = await adapter.queryJob(waiting.jobId);
    assert.equal(oldGeneration.generation, 7, 'durable job provenance must not drift to a newer Workspace generation');

    return [
      { name: 'workspace_background_modes', value: 2, unit: 'modes' },
      { name: 'shell_job_control_tools', value: 1, unit: 'tools' },
      { name: 'workspace_foreground_backend_polls', value: foregroundQueryCalls, unit: 'polls' },
      { name: 'workspace_server_wait_cases', value: 2, unit: 'cases' },
      { name: 'shell_job_cancel_cases', value: cancelCalls, unit: 'cases' },
      { name: 'workspace_background_mutation_conflicts', value: 2, unit: 'cases' },
      { name: 'shell_job_generation_provenance', value: oldGeneration.generation === 7 ? 1 : 0, unit: 'cases' },
      { name: 'shell_job_plan_controls', value: planNames.has('shell_job') ? 1 : 0, unit: 'tools' },
      {
        name: 'workspace_background_launch_unverified',
        value: backgroundLaunch.verification.status === 'unverified' ? 1 : 0,
        unit: 'cases',
      },
      {
        name: 'shell_job_verified_terminal_results',
        value: waitedToolResult.verification.status === 'verified' ? 1 : 0,
        unit: 'cases',
      },
      {
        name: 'shell_job_cancelled_verification_rejections',
        value: cancelledToolResult.verification.status === 'failed' ? 1 : 0,
        unit: 'cases',
      },
      {
        name: 'workspace_background_completion_blocks',
        value: backgroundOnlyDecision.kind === 'continue' ? 1 : 0,
        unit: 'cases',
      },
      { name: 'workspace_terminal_completion_evidence', value: 1, unit: 'cases' },
      { name: 'workspace_missing_mode_rejections', value: 1, unit: 'cases' },
    ];
  } finally {
    for (const current of pending.values()) current.reject(new Error('SCENARIO_CLEANUP'));
    pending.clear();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
