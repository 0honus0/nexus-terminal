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
import type { AgentSettingsService } from '../../../packages/backend/src/modules/agent/host/agent-settings.service';
import { createDefaultAgentSettings } from '../../../packages/backend/src/modules/agent/agent-defaults';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { ShellCapabilityService } from '../../../packages/backend/src/modules/agent/capabilities/shell-capability.service';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import {
  createWorkspaceCreateTool,
  createWorkspaceControlTool,
} from '../../../packages/backend/src/modules/agent/tools/host/workspace-runtime-management-tools';
import type { WorkspaceRuntimeService } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service';
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
    descriptors.get('shell_job_control')?.riskClass,
    'control',
    'canonical Shell must expose one bounded shell_job_control lifecycle control Tool',
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
  assert.equal(planNames.has('shell_job_control'), true, 'durable job status/wait control should remain plan-visible');
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
    listActiveJobs: async (grant) => ({
      ...grant,
      jobs: [{ jobId: runningJob.jobId, status: 'running', createdAt: runningJob.createdAt }],
    }),
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
    toolCallId: 'background-call',
    signal: new AbortController().signal,
    deadlineAt: 1_800_500_000,
    maxOutputBytes: 64 * 1024,
    inputRevision: 2,
  };
  const shellTargets = new AgentTargetResolver(toolRepository, null!, toolCrypto);
  let created = false;
  let deletedAfterCreate = false;
  const createRepository = {
    listWorkspaces: async () =>
      created ? [{ ...toolWorkspace, status: deletedAfterCreate ? ('deleted' as const) : toolWorkspace.status }] : [],
  } as unknown as AgentWorkspaceRepositoryPort;
  const createRuntime = {
    createWorkspaceWithReplay: async (...args: Parameters<WorkspaceRuntimeService['createWorkspaceWithReplay']>) => {
      assert.deepEqual(args[7], toolContext.environment, 'creation must execute the frozen environment');
      assert.equal(args[8], true, 'model tools must await terminal provisioning');
      if (created) {
        assert.equal(deletedAfterCreate, true, 'only a deleted Workspace may reach the idempotent replay path');
        return { workspace: { ...toolWorkspace, status: 'deleted' as const }, replayed: true };
      }
      created = true;
      return { workspace: { ...toolWorkspace, status: 'ready' as const }, replayed: false };
    },
  } as unknown as WorkspaceRuntimeService;
  const createCatalog = new ToolCatalog();
  createCatalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.workspace-create',
    tools: [createWorkspaceCreateTool(createRuntime, createRepository, toolCrypto)],
  });
  const createExecutor = new ToolExecutor(createCatalog, {
    authorize: async () => ({ allowed: true, policyRevision: 7 }),
  } as unknown as AppCapabilityBroker);
  const createInspection = await createExecutor.inspect(toolContext, {
    providerCallId: 'create-empty-arguments',
    name: 'workspace_create',
    argumentsJson: '{}',
  });
  const refreshedCreate = await createExecutor.refreshInspection(toolContext, createInspection);
  assert.equal(refreshedCreate.operationHash, createInspection.operationHash);
  assert.equal(new PolicyService().decide(refreshedCreate, 7).action, 'requireApproval');
  const createdResult = await createExecutor.executeMutation(toolContext, refreshedCreate);
  assert.equal(createdResult.ok, true);
  assert.equal(createdResult.outcome, 'confirmed');
  assert.equal(createdResult.verification.status, 'verified');
  await assert.rejects(() => createExecutor.refreshInspection(toolContext, refreshedCreate), /WORKSPACE_EXISTS/);
  deletedAfterCreate = true;
  const replayInspection = await createExecutor.inspect(toolContext, {
    providerCallId: 'create-idempotent-replay-after-delete',
    name: 'workspace_create',
    argumentsJson: '{}',
  });
  assert.equal(replayInspection.operationHash, createInspection.operationHash);
  const replayResult = await createExecutor.executeMutation(toolContext, replayInspection);
  assert.equal(replayResult.ok, false);
  assert.equal(replayResult.outcome, 'confirmed');
  assert.equal(replayResult.errorCode, 'WORKSPACE_CREATE_REPLAYED');
  assert.equal(replayResult.verification.status, 'failed');
  const lifecycleRuntime = {
    action: async (...args: Parameters<WorkspaceRuntimeService['action']>) => {
      assert.equal(args[3], toolWorkspace.version);
      assert.equal(args[4], true, 'model tools must await terminal lifecycle execution');
      return { id: 'lifecycle-command', generation: toolWorkspace.generation, status: 'succeeded' };
    },
  } as unknown as WorkspaceRuntimeService;
  const lifecycleCatalog = new ToolCatalog();
  lifecycleCatalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.workspace-control',
    tools: [createWorkspaceControlTool(lifecycleRuntime, toolRepository, toolCrypto)],
  });
  const lifecycleExecutor = new ToolExecutor(lifecycleCatalog, {
    authorize: async () => ({ allowed: true, policyRevision: 7 }),
  } as unknown as AppCapabilityBroker);
  const lifecycleInspection = await lifecycleExecutor.inspect(toolContext, {
    providerCallId: 'control-public-arguments',
    name: 'workspace_control',
    argumentsJson: JSON.stringify({ workspaceId: toolWorkspace.id, action: 'stop' }),
  });
  const refreshedLifecycle = await lifecycleExecutor.refreshInspection(toolContext, lifecycleInspection);
  assert.equal(refreshedLifecycle.operationHash, lifecycleInspection.operationHash);
  assert.equal(
    (await lifecycleExecutor.executeMutation(toolContext, refreshedLifecycle)).verification.status,
    'verified',
  );
  const workspaceShellTarget = new WorkspaceShellTargetAdapter(toolRepository, toolGateway, {
    get: async () => ({ effectiveSettings: createDefaultAgentSettings() }),
  } as unknown as AgentSettingsService);
  const capacityView = await workspaceShellTarget.listActiveJobs(
    toolContext,
    toolWorkspace.id,
    toolWorkspace.generation,
  );
  assert.equal(capacityView.capacity, 8);
  assert.equal(capacityView.activeCount, 1);
  assert.equal(capacityView.jobs[0]?.jobId, runningJob.jobId);
  await assert.rejects(
    () =>
      workspaceShellTarget.listActiveJobs(
        { ...toolContext, runId: 'other-run' },
        toolWorkspace.id,
        toolWorkspace.generation,
      ),
    /RESOURCE_FORBIDDEN/,
  );
  await assert.rejects(
    () =>
      workspaceShellTarget.listActiveJobs(
        { ...toolContext, agentRuntimeId: 'other-runtime' },
        toolWorkspace.id,
        toolWorkspace.generation,
      ),
    /RESOURCE_FORBIDDEN/,
  );
  await assert.rejects(
    () => workspaceShellTarget.listActiveJobs(toolContext, toolWorkspace.id, toolWorkspace.generation + 1),
    /WORKSPACE_GENERATION_CONFLICT/,
  );
  const shellService = new ShellCapabilityService(shellTargets, workspaceShellTarget, null!, toolCrypto);
  const shellTools = new Map(
    createUnifiedShellTools(shellService, toolCrypto).map((tool) => [tool.descriptor.name, tool]),
  );
  const executeTool = shellTools.get('shell_execute');
  const controlTool = shellTools.get('shell_job_control');
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
  assert.equal((backgroundLaunch.data as Record<string, JsonValue>).executionTimeoutSeconds, 60);
  assert.match(backgroundLaunch.summary, /expiry terminates this Job/);
  assert.equal(
    backgroundLaunch.verification.status,
    'unverified',
    'background launch confirms durable acceptance, not command completion',
  );
  const missingModeArguments = { ...(backgroundInspection.normalizedArguments as Record<string, JsonValue>) };
  delete missingModeArguments.mode;
  await assert.rejects(
    () => executeTool.execute({ ...backgroundInspection, normalizedArguments: missingModeArguments }, toolContext),
    /SHELL_STRING_INVALID/,
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
        toolName: 'shell_job_control',
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
  const journal = new RunnerJournal(path.join(directory, 'journal.sqlite'));
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
  let executeCalls = 0;
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
        executeCalls += 1;
        pending.set(request.jobId, { resolve, reject });
        if (['complete-later', 'nonzero-later', 'timeout-later'].includes(request.argv[0]!)) {
          setTimeout(() => {
            const current = pending.get(request.jobId);
            if (!current) return;
            pending.delete(request.jobId);
            current.resolve({
              exitCode: request.argv[0] === 'nonzero-later' ? 7 : 0,
              signal: null,
              stdout: 'done\n',
              stderr: request.argv[0] === 'complete-later' ? '' : 'failure diagnostic\n',
              truncated: false,
              timedOut: request.argv[0] === 'timeout-later',
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
      executionId: 'v1:' + operationChar.repeat(64),
      argv,
      cwd: '/workspace/work',
      maxBytes: 8 * 1024,
      timeoutMs: 2_000,
      maxConcurrentJobs: 1,
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
    const replay = await adapter.invoke(
      { workspaceId: 'background-workspace', generation: 7 },
      call('a', ['complete-later']),
      new AbortController().signal,
    );
    assert.equal(replay.jobId, foreground.jobId);
    assert.equal(executeCalls, 1, 'Replaying a durable execution must not start the process twice');
    const fresh = await adapter.invoke(
      { workspaceId: 'background-workspace', generation: 7 },
      call('f', ['complete-later']),
      new AbortController().signal,
    );
    assert.notEqual(fresh.jobId, foreground.jobId);
    assert.equal(fresh.status, 'succeeded');
    assert.equal(executeCalls, 2, 'A new execution with identical argv must actually execute');
    for (const [identity, command, code] of [
      ['0', 'nonzero-later', 'WORKSPACE_JOB_NONZERO_EXIT'],
      ['1', 'timeout-later', 'WORKSPACE_JOB_TIMEOUT'],
    ] as const) {
      const failed = await adapter.invoke(
        { workspaceId: 'background-workspace', generation: 7 },
        call(identity, [command]),
        new AbortController().signal,
      );
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error, code);
      assert.equal(failed.result?.stderr, 'failure diagnostic\n');
      assert.equal(failed.result?.timedOut, command === 'timeout-later');
      assert.deepEqual(await originalQueryJob(failed.jobId, new AbortController().signal), failed);
      const replayedFailure = await adapter.invoke(
        { workspaceId: 'background-workspace', generation: 7 },
        call(identity, [command]),
        new AbortController().signal,
      );
      assert.deepEqual(
        replayedFailure,
        failed,
        'Failed execution replay must retain the durable result, not execute again',
      );
      toolGateway.queryJob = async () => ({ ...failed, workspaceId: toolWorkspace.id });
      toolGateway.invoke = async () => ({ ...failed, workspaceId: toolWorkspace.id });
      const statusTool = createUnifiedShellTools(shellService, toolCrypto).find(
        (tool) => tool.descriptor.name === 'shell_job_control',
      )!;
      const inspection = await statusTool.inspect(
        { target: 'workspace', id: toolWorkspace.id, jobId: failed.jobId, action: 'status' },
        toolContext,
        7,
      );
      const projected = await statusTool.execute(inspection, toolContext);
      assert.equal(projected.ok, false);
      assert.equal(projected.errorCode, code);
      assert.equal(projected.verification.status, 'failed');
      assert.equal((projected.data as Record<string, JsonValue>).stderrTail, 'failure diagnostic\n');
      const foregroundInspection = await executeTool.inspect(
        {
          target: 'workspace',
          id: toolWorkspace.id,
          command: { kind: 'argv', argv: ['test-failure'] },
          mode: 'foreground',
        },
        toolContext,
        7,
      );
      const foregroundFailure = await executeTool.execute(foregroundInspection, toolContext);
      assert.equal(foregroundFailure.ok, false);
      assert.equal(foregroundFailure.errorCode, code);
      assert.equal(foregroundFailure.verification.status, 'failed');
      assert.equal((foregroundFailure.data as Record<string, JsonValue>).stderr, 'failure diagnostic\n');
    }
    toolGateway.queryJob = async () => runningJob;
    toolGateway.invoke = async () => succeededJob;
    const foregroundQueryCalls = queryCalls;
    const originalWait = adapter.waitJob.bind(adapter);
    adapter.waitJob = async (jobId) => originalQueryJob(jobId);
    const foregroundRunning = await adapter.invoke(
      { workspaceId: 'background-workspace', generation: 7 },
      call('9', ['hold']),
      new AbortController().signal,
    );
    assert.equal(
      foregroundRunning.status,
      'running',
      'confirmed active foreground Job must remain controllable after the wait window',
    );
    assert.equal(foregroundRunning.error, null);
    await adapter.cancelJob(foregroundRunning.jobId, new AbortController().signal);
    adapter.waitJob = originalWait;
    const capacityRace = await Promise.allSettled(
      ['7', '8'].map((char) =>
        adapter.startJob(
          { workspaceId: 'background-workspace', generation: 7 },
          call(char, ['hold']),
          new AbortController().signal,
        ),
      ),
    );
    assert.equal(
      capacityRace.filter((result) => result.status === 'fulfilled').length,
      1,
      'simultaneous submissions must not exceed capacity',
    );
    const loser = capacityRace.find((result) => result.status === 'rejected');
    assert.ok(loser && loser.status === 'rejected' && /WORKSPACE_JOB_ACTIVE_CONFLICT/.test(String(loser.reason)));
    const winner = capacityRace.find((result) => result.status === 'fulfilled');
    assert.ok(winner && winner.status === 'fulfilled');
    await adapter.cancelJob(winner.value.jobId, new AbortController().signal);
    const cancellationBaseline = cancelCalls;

    const background = await adapter.startJob(
      { workspaceId: 'background-workspace', generation: 7 },
      call('b', ['hold']),
      new AbortController().signal,
    );
    assert.equal(background.status, 'running', 'background start must return before terminal completion');

    const concurrent = await adapter.startJob(
      { workspaceId: 'background-workspace', generation: 7 },
      { ...call('e', ['hold']), maxConcurrentJobs: 2 },
      new AbortController().signal,
    );
    assert.equal(concurrent.status, 'running');
    const active = await adapter.listActiveJobs(
      { workspaceId: 'background-workspace', generation: 7 },
      new AbortController().signal,
    );
    assert.deepEqual(active.jobs.map((job) => job.jobId).sort(), [background.jobId, concurrent.jobId].sort());
    assert.ok(active.jobs.every((job) => job.status === 'running'));
    const stillRunning = await adapter.waitJob(background.jobId, 1, new AbortController().signal);
    assert.equal(stillRunning.status, 'running', 'wait expiry must not stop or misclassify the Job');
    await assert.rejects(
      () =>
        adapter.listActiveJobs({ workspaceId: 'background-workspace', generation: 8 }, new AbortController().signal),
      /WORKSPACE_GENERATION_CONFLICT/,
    );

    await assert.rejects(
      () =>
        adapter.startJob(
          { workspaceId: 'background-workspace', generation: 7 },
          call('c', ['second']),
          new AbortController().signal,
        ),
      /WORKSPACE_JOB_ACTIVE_CONFLICT/,
      'lowering capacity to one must reject new work without cancelling active jobs',
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
    assert.equal(cancelCalls, cancellationBaseline + 1);
    assert.equal(
      (await adapter.queryJob(concurrent.jobId)).status,
      'running',
      'cancelling one Job must not cancel another',
    );
    await adapter.cancelJob(concurrent.jobId, new AbortController().signal);
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
      { name: 'shell_job_plan_controls', value: planNames.has('shell_job_control') ? 1 : 0, unit: 'tools' },
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
    const persistedWorkspace = journal.workspace('background-workspace');
    const persistedJobs = journal.jobs();
    journal.close();
    const recovered = new RunnerJournal(path.join(directory, 'journal.sqlite'));
    try {
      assert.deepEqual(recovered.workspace('background-workspace'), persistedWorkspace);
      assert.deepEqual(
        recovered.jobs().sort((a, b) => a.jobId.localeCompare(b.jobId)),
        persistedJobs.sort((a, b) => a.jobId.localeCompare(b.jobId)),
      );
    } finally {
      recovered.close();
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
