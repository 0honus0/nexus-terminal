import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { PolicyService } from '../../../packages/backend/src/modules/agent/capabilities/policy.service';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolResult,
} from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';
import { AgentEventHub } from '../../../packages/backend/src/modules/agent/runtime/events/event-hub';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import { SubagentCompletionCoordinator } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-completion-coordinator';
import { SubagentToolStepExecutor } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-tool-step-executor';
import { builtInSubagentProfileTemplates } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-profile-templates';
import { governedSubagentWorkspaceMutation } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-mutation-policy';
import type {
  DelegationView,
  SchedulerWorkView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { requestHash } from '../../../packages/backend/src/modules/agent/runtime/runs/idempotency';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { emptyModelContinuations, scenarioDelegationModel, SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const subagentGovernedMutationScenario = async () => {
  const scenarioScope: Scope = { userId: 1, appId: 'subagent-governed-mutation-app' };
  const executionOrder: string[] = [];
  let scenarioMutationExecutions = 0;
  const catalog = new ToolCatalog();
  const mutationTool: AgentTool = {
    descriptor: {
      name: 'scenario_workspace_mutate',
      version: '1',
      description: 'Scenario-only governed Workspace mutation.',
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass: 'mutate',
      capability: 'file.write',
    },
    inspect: async (_input, context, policyRevision) => ({
      toolName: 'scenario_workspace_mutate',
      toolVersion: '1',
      normalizedArguments: {},
      target: {
        kind: 'workspace',
        target: 'workspace',
        id: 'scenario-child',
        workspaceId: 'scenario-child',
        generation: 1,
        targetIdentity: 'workspace:scenario-child:1',
        endpoint: 'workspace:scenario-child',
        loginUser: 'agent-runtime',
        configurationHash: 'scenario-workspace-generation-1',
      },
      resourceKeys: ['workspace:scenario-child:1:file:src/example.ts'],
      risk: 'mutate',
      mutation: true,
      operationHash: 'scenario-subagent-mutation-operation',
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    }),
    execute: async () => {
      executionOrder.push('tool.execute');
      scenarioMutationExecutions += 1;
      return {
        ok: true,
        summary: 'Scenario mutation completed.',
        data: null,
        artifactRefs: ['artifact:scenario-diff', 'artifact:scenario-test'],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary: 'Scenario verification.',
          evidenceRefs: ['artifact:scenario-diff', 'artifact:scenario-test'],
        },
      };
    },
  };
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.subagent-governed-mutation',
    tools: [mutationTool],
  });
  const machineMutationTool: AgentTool = {
    ...mutationTool,
    descriptor: {
      ...mutationTool.descriptor,
      name: 'scenario_machine_mutate',
      capability: 'file.write',
    },
  };
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.subagent-machine-mutation',
    tools: [machineMutationTool],
  });
  let forbiddenTargetExecutions = 0;
  const misdeclaredWorkspaceMutationTool: AgentTool = {
    ...mutationTool,
    descriptor: {
      ...mutationTool.descriptor,
      name: 'scenario_misdeclared_workspace_mutate',
      capability: 'file.write',
    },
    inspect: async (_input, context, policyRevision) => ({
      ...(await mutationTool.inspect({}, context, policyRevision)),
      toolName: 'scenario_misdeclared_workspace_mutate',
      target: {
        kind: 'ssh',
        target: 'ssh',
        id: '42',
        connectionId: 42,
        targetIdentity: 'machine:42',
        endpoint: 'ssh://example.invalid',
        loginUser: 'root',
        configurationHash: 'misdeclared-workspace-target',
        hostKeyTrust: 'unavailable',
      },
      resourceKeys: ['connection:42:path:/tmp/not-a-workspace'],
      operationHash: 'scenario-misdeclared-workspace-operation',
    }),
    execute: async () => {
      forbiddenTargetExecutions += 1;
      return {
        ok: true,
        summary: 'forbidden target executed',
        data: null,
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: { status: 'verified', summary: 'unexpected', evidenceRefs: [] },
      };
    },
  };
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.subagent-misdeclared-workspace-mutation',
    tools: [misdeclaredWorkspaceMutationTool],
  });
  const builder = new SubagentContextBuilder(
    null!,
    null!,
    catalog,
    new CapabilityRegistry(),
    emptyModelContinuations,
    null!,
    {
      nowUnixSeconds: () => 1_800_570_000,
    } as ClockPort,
  );
  const baseDelegation = {
    userId: 1,
    appId: scenarioScope.appId,
    id: 'scenario-governed-delegation',
    runId: 'scenario-governed-run',
    parentRuntimeId: 'scenario-root-runtime',
    childRuntimeId: 'scenario-child-runtime',
    profileId: 'scenario-worker',
    grants: [
      {
        capability: 'file.write',
        schemaVersion: 2,
        scope: { kind: 'targets', targets: { workspace: { mode: 'ids', ids: ['scenario-child'] } } },
      },
    ],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    objective: 'Modify only src/example.ts and run the focused test.',
    constraints: ['Use only the isolated child Workspace.'],
    inputArtifactRefs: [],
    completionCriteria: ['Return verified mutation evidence.'],
    dependencyMode: 'settled',
    status: 'running',
    depth: 1,
    failureMode: 'isolate',
    budget: { maxSteps: 12 },
    usage: { tokens: 0, steps: 0 },
    result: null,
    evidenceRefs: [],
    deadlineAt: 1_900_000_000,
    version: 1,
    createdAt: 1_800_570_000,
    updatedAt: 1_800_570_000,
    completedAt: null,
  } satisfies DelegationView;
  assert.equal(
    builder.allowsTool(scenarioScope, baseDelegation, mutationTool.descriptor.name),
    false,
    'read-only Subagents must continue rejecting mutation Tools even when the capability is present',
  );
  const governedDelegation = {
    ...baseDelegation,
    mutationMode: 'governed',
  } as unknown as DelegationView;
  assert.equal(
    builder.allowsTool(scenarioScope, governedDelegation, mutationTool.descriptor.name),
    true,
    'explicit governed workers must expose mutation Tools through the existing capability-filtered surface',
  );
  assert.equal(
    builder.allowsProposal(scenarioScope, governedDelegation, {
      providerCallId: 'scenario-ssh-write',
      name: machineMutationTool.descriptor.name,
      argumentsJson: JSON.stringify({ target: 'ssh', id: '42' }),
    }),
    false,
    'governed workers must stay confined to the Workspace target scope carried by their delegated file.write grant',
  );
  assert.deepEqual(
    builtInSubagentProfileTemplates(64).map((template) => template.id),
    ['explore', 'scout', 'review', 'general', 'worker'],
    'the built-in catalog must expose an explicit governed worker preset without mutating read-only templates',
  );
  const toolSchemas = (
    builder as unknown as {
      toolSchemas(
        scope: Scope,
        delegation: DelegationView,
        model: { supportsTools: boolean },
        run: RunView,
      ): Array<{ name: string }>;
    }
  ).toolSchemas.bind(builder);
  const runForMode = (approvalMode: 'ask' | 'full_access') =>
    ({
      id: baseDelegation.runId,
      userId: 1,
      appId: scenarioScope.appId,
      definition: { approvalMode, environment: { transport: 'workspace-profile' } },
    }) as unknown as RunView;
  assert.equal(
    toolSchemas(scenarioScope, governedDelegation, { supportsTools: true }, runForMode('ask')).some(
      (schema) => schema.name === mutationTool.descriptor.name,
    ),
    false,
    'ask-mode Runs must not expose mutation Tools to governed workers because Child approval cannot be parked safely',
  );
  assert.equal(
    toolSchemas(scenarioScope, governedDelegation, { supportsTools: true }, runForMode('full_access')).some(
      (schema) => schema.name === mutationTool.descriptor.name,
    ),
    true,
    'governed workers on explicit Full Access Runs may expose Workspace mutation Tools',
  );
  assert.equal(
    toolSchemas(scenarioScope, baseDelegation, { supportsTools: true }, runForMode('full_access')).some(
      (schema) => schema.name === mutationTool.descriptor.name,
    ),
    false,
    'Full Access must not override a read-only Subagent profile',
  );

  const fullAccessRun = {
    id: baseDelegation.runId,
    userId: scenarioScope.userId,
    appId: scenarioScope.appId,
    status: 'running',
    needsReconciliation: false,
    version: 1,
    inputRevision: 1,
    definition: {
      approvalMode: 'full_access',
      connectionIds: [],
      policyRevision: 1,
      environment: null,
    },
    budget: { toolTimeoutSeconds: 120, maxToolOutputBytes: 1_048_576 },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    },
  } as unknown as RunView;
  const toolStepId = 'scenario-governed-tool-step';
  const toolCallId = 'scenario-governed-tool-call';
  const work: SchedulerWorkView = {
    id: 'scenario-governed-tool-work',
    enqueueSequence: 1,
    runId: fullAccessRun.id,
    agentRuntimeId: baseDelegation.childRuntimeId,
    kind: 'tool_step',
    status: 'claimed',
    payload: { delegationId: baseDelegation.id, toolStepId, toolCallId },
    ownerEpoch: 7,
    notBefore: 1_800_570_000,
    deadlineAt: 1_900_000_000,
    createdAt: 1_800_570_000,
    updatedAt: 1_800_570_000,
    version: 2,
  };
  const signal = new AbortController().signal;
  const mutationContext: ToolContext = {
    userId: scenarioScope.userId,
    appId: scenarioScope.appId,
    actor: {
      kind: 'agent',
      userId: scenarioScope.userId,
      appId: scenarioScope.appId,
      runId: fullAccessRun.id,
      agentRuntimeId: baseDelegation.childRuntimeId,
    },
    runId: fullAccessRun.id,
    agentRuntimeId: baseDelegation.childRuntimeId,
    connectionIds: [],
    environment: null,
    stepId: toolStepId,
    signal,
    deadlineAt: work.deadlineAt,
    maxOutputBytes: 1_048_576,
    inputRevision: 1,
  };
  const persistedInspection = await mutationTool.inspect({}, mutationContext, 1);
  const pendingWorkspaceResource = `workspace:new:${fullAccessRun.id}:${baseDelegation.childRuntimeId}`;
  assert.equal(
    governedSubagentWorkspaceMutation(
      {
        ...persistedInspection,
        target: {
          kind: 'workspace',
          target: 'workspace',
          id: `new:${fullAccessRun.id}:${baseDelegation.childRuntimeId}`,
          targetIdentity: pendingWorkspaceResource,
          endpoint: 'workspace:new',
          loginUser: 'runner:65532',
          configurationHash: 'scenario-pending-workspace',
        },
        resourceKeys: [pendingWorkspaceResource],
      },
      fullAccessRun.id,
      baseDelegation.childRuntimeId,
    ),
    true,
    'governed Child must be able to provision a Workspace bound to its own Run/runtime before an id exists',
  );
  let mutationLeaseAcquisitions = 0;
  const mutationLeasePort = {
    acquire: async () => {
      mutationLeaseAcquisitions += 1;
      executionOrder.push('lease.acquire');
      let active = false;
      return {
        signal,
        stopRenewal: async () => null,
        activate: async () => {
          active = true;
          executionOrder.push('lease.activate');
        },
        quarantine: async () => {
          executionOrder.push('lease.quarantine');
        },
        confirm: async () => {
          assert.equal(active, true, 'mutation lease must be active before it is confirmed');
          active = false;
          executionOrder.push('lease.confirm');
          return { ok: true as const };
        },
        releaseIfInactive: async () => {
          assert.equal(active, false, 'cleanup must not release an active mutation lease');
          executionOrder.push('lease.release');
        },
      };
    },
  };
  const toolRunner = new ToolCallRunner(
    catalog,
    new ToolExecutor(catalog, {
      authorize: async () => ({ allowed: true, policyRevision: 1 }),
    } as never),
    new PolicyService(),
    null!,
    mutationLeasePort as never,
  );
  let lastSettledMutation: { result: ToolResult; needsReconciliation?: boolean } | undefined;
  const runAt = (version: number, status: RunView['status'] = 'running'): RunView =>
    ({ ...fullAccessRun, version, status }) as RunView;
  const stateCommit = {
    beginSubagentTool: async () => {
      executionOrder.push('state.begin-read');
      return { run: runAt(2), eventCursor: 2, ledgerCursor: 0, committedEvents: [] };
    },
    requestToolApproval: async () => {
      executionOrder.push('approval.request');
      return { run: runAt(2, 'awaiting_approval'), eventCursor: 2, ledgerCursor: 0, committedEvents: [] };
    },
    resolveToolApproval: async () => {
      executionOrder.push('approval.approve');
      return { run: runAt(3), eventCursor: 3, ledgerCursor: 0, committedEvents: [] };
    },
    beginSubagentMutationTool: async () => {
      executionOrder.push('state.begin');
      return { run: runAt(4), eventCursor: 4, ledgerCursor: 0, committedEvents: [] };
    },
    settleSubagentTool: async (command: { result: ToolResult; needsReconciliation?: boolean }) => {
      executionOrder.push('state.settle');
      lastSettledMutation = {
        result: command.result,
        ...(command.needsReconciliation ? { needsReconciliation: true } : {}),
      };
      return {
        run:
          command.result.outcome === 'unknown'
            ? ({ ...runAt(5, 'interrupted'), needsReconciliation: true } as RunView)
            : runAt(5),
        eventCursor: 5,
        ledgerCursor: 0,
        committedEvents: [],
      };
    },
    evaluateToolLoopGuard: async () => {
      executionOrder.push('loop.guard');
      return { run: runAt(6), eventCursor: 6, ledgerCursor: 0, committedEvents: [] };
    },
    refreshProposedTool: async () => {
      throw new Error('SCENARIO_UNEXPECTED_REFRESH');
    },
    commit: async () => {
      throw new Error('SCENARIO_UNEXPECTED_RECONCILIATION_COMMIT');
    },
  };
  const completion = new SubagentCompletionCoordinator(
    null!,
    null!,
    {
      recentRuntimeToolExchanges: async () => [
        {
          sourceModelStepId: 'scenario-mutation-model-step',
          batchIndex: 0,
          batchSize: 2,
          providerCallId: 'scenario-verified-call',
          toolName: mutationTool.descriptor.name,
          arguments: {},
          status: 'succeeded',
          result: {
            ok: true,
            summary: 'Verified worker evidence.',
            data: null,
            artifactRefs: ['artifact:scenario-diff'],
            truncated: false,
            outcome: 'confirmed',
            verification: {
              status: 'verified',
              summary: 'Focused test passed.',
              evidenceRefs: ['artifact:scenario-test'],
            },
          },
        },
        {
          sourceModelStepId: 'scenario-mutation-model-step',
          batchIndex: 1,
          batchSize: 2,
          providerCallId: 'scenario-unverified-call',
          toolName: 'scenario_unverified_claim',
          arguments: {},
          status: 'failed',
          result: {
            ok: false,
            summary: 'Model-visible but unverified claim.',
            data: null,
            artifactRefs: ['artifact:must-not-propagate'],
            truncated: false,
            outcome: 'confirmed',
            verification: {
              status: 'unverified',
              summary: 'No durable verification.',
              evidenceRefs: ['artifact:also-must-not-propagate'],
            },
          },
        },
      ],
    } as never,
    stateCommit as never,
    { send: async () => undefined } as never,
    new AgentEventHub(),
    {
      enqueueRootRun: async () => undefined,
      wakeChildScheduler: () => undefined,
      cancelChildRuntime: () => undefined,
    },
    { nowUnixSeconds: () => 1_800_570_000 } as ClockPort,
  );
  const mutationExecutor = new SubagentToolStepExecutor(
    null!,
    null!,
    null!,
    { confirmedMutation: async () => null } as never,
    stateCommit as never,
    null!,
    toolRunner,
    completion,
    new AgentEventHub(),
    { nowUnixSeconds: () => 1_800_570_000 } as ClockPort,
    async (_run, reason) => {
      assert.equal(reason, 'mutation_confirmed');
      executionOrder.push('recovery.checkpoint');
    },
  );
  const forbiddenInspection = await misdeclaredWorkspaceMutationTool.inspect({}, mutationContext, 1);
  executionOrder.length = 0;
  await (
    mutationExecutor as unknown as {
      executeChildMutation(
        scope: Scope,
        work: SchedulerWorkView,
        ownerEpoch: number,
        signal: AbortSignal,
        delegation: DelegationView,
        run: RunView,
        toolWork: {
          toolStepId: string;
          toolCallId: string;
          providerCallId: string;
          status: string;
          approvalId: string | null;
          inspection: ToolInspection;
        },
      ): Promise<void>;
    }
  ).executeChildMutation(scenarioScope, work, 7, signal, governedDelegation, fullAccessRun, {
    toolStepId,
    toolCallId,
    providerCallId: 'scenario-forbidden-target-call',
    status: 'proposed',
    approvalId: null,
    inspection: forbiddenInspection,
  });
  assert.equal(forbiddenTargetExecutions, 0, 'governed Child must never execute a non-Workspace mutation target');
  assert.equal(
    mutationLeaseAcquisitions,
    0,
    'non-Workspace mutation targets must be rejected before acquiring any mutation lease',
  );
  assert.deepEqual(
    executionOrder,
    ['state.begin-read', 'state.settle'],
    'misdeclared Workspace-capability mutations must settle as failed without approval or side effects',
  );

  executionOrder.length = 0;
  await (
    mutationExecutor as unknown as {
      executeChildMutation(
        scope: Scope,
        work: SchedulerWorkView,
        ownerEpoch: number,
        signal: AbortSignal,
        delegation: DelegationView,
        run: RunView,
        toolWork: {
          toolStepId: string;
          toolCallId: string;
          providerCallId: string;
          status: string;
          approvalId: string | null;
          inspection: ToolInspection;
        },
      ): Promise<void>;
    }
  ).executeChildMutation(scenarioScope, work, 7, signal, governedDelegation, fullAccessRun, {
    toolStepId,
    toolCallId,
    providerCallId: 'scenario-provider-call',
    status: 'proposed',
    approvalId: null,
    inspection: persistedInspection,
  });
  assert.deepEqual(
    executionOrder,
    [
      'approval.request',
      'approval.approve',
      'lease.acquire',
      'state.begin',
      'lease.activate',
      'tool.execute',
      'state.settle',
      'lease.confirm',
      'loop.guard',
      'recovery.checkpoint',
      'lease.release',
    ],
    'fresh governed mutation must preserve the existing approval/lease/StateCommit/verification/recovery authority order',
  );
  assert.equal(scenarioMutationExecutions, 1);
  assert.deepEqual(lastSettledMutation?.result.verification.evidenceRefs, [
    'artifact:scenario-diff',
    'artifact:scenario-test',
  ]);
  const workerEvidence = await (
    completion as unknown as {
      verifiedRuntimeEvidenceRefs(scope: Scope, runId: string, runtimeId: string): Promise<string[]>;
    }
  ).verifiedRuntimeEvidenceRefs(scenarioScope, fullAccessRun.id, baseDelegation.childRuntimeId);
  assert.deepEqual(
    workerEvidence,
    ['artifact:scenario-diff', 'artifact:scenario-test'],
    'Worker completion evidence must come only from confirmed + verified Tool results, never unverified model claims',
  );
  const workerEvidenceProjection = await (
    completion as unknown as {
      verifiedRuntimeEvidence(
        scope: Scope,
        runId: string,
        runtimeId: string,
      ): Promise<{
        artifactRefs: string[];
        tools: Array<{ toolName: string; summary: string; verificationSummary: string; evidenceRefs: string[] }>;
      }>;
    }
  ).verifiedRuntimeEvidence(scenarioScope, fullAccessRun.id, baseDelegation.childRuntimeId);
  assert.deepEqual(
    workerEvidenceProjection.tools.map((tool) => tool.toolName),
    [mutationTool.descriptor.name],
    'durable Worker result must summarize only confirmed + verified Tool facts, not unverified natural-language claims',
  );

  executionOrder.length = 0;
  lastSettledMutation = undefined;
  await (
    mutationExecutor as unknown as {
      executeChildMutation(
        scope: Scope,
        work: SchedulerWorkView,
        ownerEpoch: number,
        signal: AbortSignal,
        delegation: DelegationView,
        run: RunView,
        toolWork: {
          toolStepId: string;
          toolCallId: string;
          providerCallId: string;
          status: string;
          approvalId: string | null;
          inspection: ToolInspection;
        },
      ): Promise<void>;
    }
  ).executeChildMutation(scenarioScope, work, 7, signal, governedDelegation, fullAccessRun, {
    toolStepId,
    toolCallId,
    providerCallId: 'scenario-provider-call',
    status: 'running',
    approvalId: null,
    inspection: persistedInspection,
  });
  assert.equal(
    scenarioMutationExecutions,
    1,
    'a reclaimed Child mutation already in durable running state must never replay its side effect',
  );
  assert.equal(lastSettledMutation?.result.outcome, 'unknown');
  assert.equal(lastSettledMutation?.needsReconciliation, true);
  assert.deepEqual(
    executionOrder,
    ['state.settle'],
    'restart recovery must go directly to reconciliation without approval, lease acquisition, or mutation execution',
  );

  const durableDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-subagent-governed-mutation-'));
  const durableDb = new DatabaseAdapter({
    dataDirectory: durableDirectory,
    filename: 'governed-mutation.sqlite',
    nodeEnv: 'test',
  });
  try {
    await durableDb.initialize();
    const durableCommit = new SqliteStateCommitAdapter(durableDb);
    const durableNow = 1_800_570_000;
    const durableRunId = 'governed-mutation-run';
    const durableRootRuntimeId = 'governed-mutation-root';
    const durableChildRuntimeId = 'governed-mutation-child';
    const durableDelegationId = 'governed-mutation-delegation';
    const durableModelStepId = 'governed-mutation-model-step';
    const durableToolStepId = 'governed-mutation-tool-step';
    const durableToolCallId = 'governed-mutation-tool-call';
    const durableWorkId = 'governed-mutation-work';
    const durableApprovalId = 'governed-mutation-approval';
    const durableOperationHash = 'governed-mutation-operation-hash';
    const durableModelRef = JSON.stringify({
      providerId: 'scenario-provider',
      modelId: 'scenario-model',
      configurationVersion: 1,
    });
    await durableDb.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'governed-mutation-user', 'not-used')",
    );
    await durableDb.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, policy_revision, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, 1, ?, ?)`,
      [scenarioScope.appId, durableNow, durableNow],
    );
    await durableDb.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('governed-mutation-thread', 1, ?, 'governed mutation', 'manual', ?, ?)`,
      [scenarioScope.appId, durableNow, durableNow],
    );
    await durableDb.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         input_revision, created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'governed-mutation-thread', 'running', 'in_progress', 'not_started',
               ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
      [
        durableRunId,
        scenarioScope.appId,
        JSON.stringify({
          maxRunSteps: 100,
          maxActiveExecutionSeconds: 3_600,
          toolTimeoutSeconds: 120,
          maxToolOutputBytes: 1_048_576,
          maxRecallItems: 5,
          maxRecallBytes: 8_192,
          maxSubagentMessages: 100,
          maxSubagentMessageBytes: 1_048_576,
          contextPolicy: freezeRunContextPolicy('normal'),
          contextCompactionMode: 'balanced',
          revision: 1,
        }),
        JSON.stringify({
          schemaVersion: 1,
          agentDefinitionId: 'scenario-agent',
          requiredModelCapabilities: [],
          model: JSON.parse(durableModelRef),
          modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
          rootModelRoutes: [],
          approvalMode: 'full_access',
          executionMode: 'execute',
          connectionIds: [],
          environment: null,
          policyRevision: 1,
          settingsRevision: 1,
        }),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify({
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          steps: 0,
          subagentMessages: 0,
          subagentMessageBytes: 0,
        }),
        durableNow,
        durableNow,
        durableNow,
      ],
    );
    await durableDb.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES
        (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-governed-root', ?, ?),
        (?, ?, 'subagent:governed', 'native', ?, 'running', 'runnable', 0, 'owner-governed-child', ?, ?)`,
      [
        durableRootRuntimeId,
        durableRunId,
        durableModelRef,
        durableNow,
        durableNow,
        durableChildRuntimeId,
        durableRunId,
        durableModelRef,
        durableNow,
        durableNow,
      ],
    );
    await durableDb.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         mutation_mode, model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'worker', ?, 'parent-child', 'governed', ?, 'Edit isolated workspace',
               '[]', '[]', '[]', 'settled', 'running', 1, 'isolate', 12, 'governed-key',
               'governed-request-hash', ?, 1, ?, ?)`,
      [
        durableDelegationId,
        durableRunId,
        durableRootRuntimeId,
        durableChildRuntimeId,
        JSON.stringify([
          {
            capability: 'file.write',
            schemaVersion: 2,
            scope: { kind: 'targets', targets: { workspace: { mode: 'all' } } },
          },
        ]),
        scenarioDelegationModel(durableModelRef),
        durableNow + 600,
        durableNow,
        durableNow,
      ],
    );
    await durableDb.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
        (?, ?, ?, 1, 'model', 'completed', 1, '[]', '[]', ?, ?),
        (?, ?, ?, 2, 'tool', 'created', 1, '[]', '[]', ?, NULL)`,
      [
        durableModelStepId,
        durableRunId,
        durableChildRuntimeId,
        durableNow,
        durableNow,
        durableToolStepId,
        durableRunId,
        durableChildRuntimeId,
        durableNow,
      ],
    );
    const durableInspection: ToolInspection = {
      toolName: 'scenario_workspace_mutate',
      toolVersion: '1',
      normalizedArguments: {},
      target: {
        kind: 'workspace',
        target: 'workspace',
        id: 'governed-child',
        workspaceId: 'governed-child',
        generation: 1,
        targetIdentity: 'workspace:governed-child:1',
        endpoint: 'workspace:governed-child',
        loginUser: 'agent-runtime',
        configurationHash: 'workspace-generation-1',
      },
      resourceKeys: ['workspace:governed-child:1:file:src/example.ts'],
      risk: 'mutate',
      mutation: true,
      operationHash: durableOperationHash,
      operationHashVersion: 1,
      preconditions: [],
      policyRevision: 1,
      inputRevision: 1,
    };
    await durableDb.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'provider-governed-mutation', 'scenario_workspace_mutate', '1',
               ?, ?, 1, 'mutate', 'proposed', ?)`,
      [
        durableToolCallId,
        durableRunId,
        durableChildRuntimeId,
        durableToolStepId,
        durableModelStepId,
        JSON.stringify(durableInspection),
        durableOperationHash,
        durableNow,
      ],
    );
    await durableDb.execute(
      `INSERT INTO agent_scheduler_work
        (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
         deadline_at, created_at, updated_at, version)
       VALUES (?, ?, ?, 'tool_step', 'claimed', ?, 7, ?, ?, ?, ?, 1)`,
      [
        durableWorkId,
        durableRunId,
        durableChildRuntimeId,
        JSON.stringify({
          delegationId: durableDelegationId,
          toolStepId: durableToolStepId,
          toolCallId: durableToolCallId,
        }),
        durableNow,
        durableNow + 600,
        durableNow,
        durableNow,
      ],
    );

    const requested = await durableCommit.requestToolApproval({
      scope: scenarioScope,
      runId: durableRunId,
      runtimeId: durableChildRuntimeId,
      toolStepId: durableToolStepId,
      toolCallId: durableToolCallId,
      approvalId: durableApprovalId,
      expectedRunVersion: 1,
      inspection: durableInspection,
      expiresAt: durableNow + 300,
      now: durableNow,
    });
    assert.equal(requested.run.status, 'awaiting_approval');
    const resolved = await durableCommit.resolveToolApproval({
      scope: scenarioScope,
      runId: durableRunId,
      approvalId: durableApprovalId,
      decision: 'approved',
      operationHash: durableOperationHash,
      expectedApprovalVersion: 1,
      expectedRunVersion: requested.run.version,
      expectedPolicyRevision: 1,
      expectedInputRevision: 1,
      decidedByUserId: scenarioScope.userId,
      resolutionSource: 'full_access',
      idempotencyKey: 'governed-mutation-approval-resolution',
      requestHash: requestHash(1, {
        approvalId: durableApprovalId,
        runId: durableRunId,
        decision: 'approved',
        operationHash: durableOperationHash,
        expectedVersion: 1,
      }),
      now: durableNow,
    });
    assert.equal(resolved.run.status, 'running');
    const beginDurableMutation = () =>
      durableCommit.beginSubagentMutationTool({
        scope: scenarioScope,
        runId: durableRunId,
        runtimeId: durableChildRuntimeId,
        delegationId: durableDelegationId,
        workId: durableWorkId,
        ownerEpoch: 7,
        toolStepId: durableToolStepId,
        toolCallId: durableToolCallId,
        approvalId: durableApprovalId,
        operationHash: durableOperationHash,
        expectedPolicyRevision: 1,
        expectedInputRevision: 1,
        now: durableNow + 1,
      });

    await durableDb.execute("UPDATE agent_delegations SET mutation_mode = 'read-only' WHERE id = ?", [
      durableDelegationId,
    ]);
    await assert.rejects(
      beginDurableMutation,
      (error: unknown) => error instanceof Error && error.message === 'SUBAGENT_MUTATION_NOT_GOVERNED',
      'StateCommit must reject a durable Child mutation when the frozen delegation is read-only',
    );
    await durableDb.execute("UPDATE agent_delegations SET mutation_mode = 'governed' WHERE id = ?", [
      durableDelegationId,
    ]);

    const definitionRow = await durableDb.queryOne<{ definition_json: string }>(
      'SELECT definition_json FROM agent_runs WHERE id = ?',
      [durableRunId],
    );
    assert.ok(definitionRow);
    const askDefinition = { ...JSON.parse(definitionRow.definition_json), approvalMode: 'ask' };
    await durableDb.execute('UPDATE agent_runs SET definition_json = ? WHERE id = ?', [
      JSON.stringify(askDefinition),
      durableRunId,
    ]);
    await assert.rejects(
      beginDurableMutation,
      (error: unknown) => error instanceof Error && error.message === 'SUBAGENT_MUTATION_NOT_GOVERNED',
      'StateCommit must reject a durable Child mutation when the Run is no longer Full Access',
    );
    await durableDb.execute('UPDATE agent_runs SET definition_json = ? WHERE id = ?', [
      definitionRow.definition_json,
      durableRunId,
    ]);
    const forbiddenDurableInspection: ToolInspection = {
      ...durableInspection,
      target: {
        kind: 'ssh',
        target: 'ssh',
        id: '42',
        connectionId: 42,
        targetIdentity: 'machine:42',
        endpoint: 'ssh://example.invalid',
        loginUser: 'root',
        configurationHash: 'forbidden-durable-target',
        hostKeyTrust: 'unavailable',
      },
      resourceKeys: ['connection:42:path:/tmp/not-a-workspace'],
    };
    await durableDb.execute('UPDATE agent_tool_calls SET inspection_json = ? WHERE id = ?', [
      JSON.stringify(forbiddenDurableInspection),
      durableToolCallId,
    ]);
    await assert.rejects(
      beginDurableMutation,
      (error: unknown) => error instanceof Error && error.message === 'SUBAGENT_MUTATION_TARGET_FORBIDDEN',
      'StateCommit must independently reject a non-Workspace Child mutation target before consuming approval',
    );
    await durableDb.execute('UPDATE agent_tool_calls SET inspection_json = ? WHERE id = ?', [
      JSON.stringify(durableInspection),
      durableToolCallId,
    ]);
    assert.equal(
      (
        await durableDb.queryOne<{ consumed_at: number | null }>(
          'SELECT consumed_at FROM agent_approvals WHERE id = ?',
          [durableApprovalId],
        )
      )?.consumed_at,
      null,
      'rejected durable governance checks must not consume the approved mutation',
    );
    assert.equal(
      (
        await durableDb.queryOne<{ status: string }>('SELECT status FROM agent_tool_calls WHERE id = ?', [
          durableToolCallId,
        ])
      )?.status,
      'ready',
      'rejected durable governance checks must not advance the Tool state',
    );

    const begun = await beginDurableMutation();
    assert.equal(begun.run.executingRuntimeCount, 1);
    assert.equal(
      (
        await durableDb.queryOne<{ consumed_at: number | null }>(
          'SELECT consumed_at FROM agent_approvals WHERE id = ?',
          [durableApprovalId],
        )
      )?.consumed_at,
      durableNow + 1,
      'approved Child mutation must consume its approval in the same durable begin transition',
    );
    assert.equal(
      (
        await durableDb.queryOne<{ status: string }>('SELECT status FROM agent_tool_calls WHERE id = ?', [
          durableToolCallId,
        ])
      )?.status,
      'running',
    );
    assert.equal(
      (
        await durableDb.queryOne<{ schedule_state: string }>('SELECT schedule_state FROM agent_runtimes WHERE id = ?', [
          durableChildRuntimeId,
        ])
      )?.schedule_state,
      'executing',
    );
    const approvalEvents = await durableDb.queryAll<{ type: string }>(
      `SELECT type FROM agent_events WHERE run_id = ?
       AND type IN ('approval.requested','approval.approved','approval.consumed')
       ORDER BY sequence`,
      [durableRunId],
    );
    assert.deepEqual(
      approvalEvents.map((event) => event.type),
      ['approval.requested', 'approval.approved', 'approval.consumed'],
      'Child mutation approval must use the same durable requested/approved/consumed audit events as Root mutation',
    );

    const unknownResult: ToolResult = {
      ok: false,
      summary: 'Scenario mutation outcome unknown.',
      data: { error: { code: 'SCENARIO_MUTATION_UNKNOWN' } },
      artifactRefs: [],
      truncated: false,
      outcome: 'unknown',
      errorCode: 'SCENARIO_MUTATION_UNKNOWN',
      verification: { status: 'unverified', summary: 'Reconciliation required.', evidenceRefs: [] },
    };
    const interrupted = await durableCommit.settleSubagentTool({
      scope: scenarioScope,
      runId: durableRunId,
      runtimeId: durableChildRuntimeId,
      delegationId: durableDelegationId,
      workId: durableWorkId,
      ownerEpoch: 7,
      toolStepId: durableToolStepId,
      toolCallId: durableToolCallId,
      result: unknownResult,
      needsReconciliation: true,
      continuation: 'runnable',
      now: durableNow + 2,
    });
    assert.equal(interrupted.run.status, 'interrupted');
    assert.equal(interrupted.run.needsReconciliation, true);
    assert.equal(
      (
        await durableDb.queryOne<{ status: string }>('SELECT status FROM agent_tool_calls WHERE id = ?', [
          durableToolCallId,
        ])
      )?.status,
      'reconciling',
    );
    assert.equal(
      (
        await durableDb.queryOne<{ status: string; mutation_mode: string }>(
          'SELECT status, mutation_mode FROM agent_delegations WHERE id = ?',
          [durableDelegationId],
        )
      )?.status,
      'failed',
    );
    assert.equal(
      (
        await durableDb.queryOne<{ mutation_mode: string }>(
          'SELECT mutation_mode FROM agent_delegations WHERE id = ?',
          [durableDelegationId],
        )
      )?.mutation_mode,
      'governed',
      'delegation must durably freeze the mutation governance mode',
    );
  } finally {
    await durableDb.close().catch(() => undefined);
    fs.rmSync(durableDirectory, { recursive: true, force: true });
  }

  return [
    { name: 'read_only_mutation_tools', value: 0, unit: 'tools' },
    { name: 'governed_worker_mutation_tools', value: 1, unit: 'tools' },
    { name: 'raw_machine_mutation_tools', value: 0, unit: 'tools' },
    {
      name: 'governed_subagent_non_workspace_target_rejections',
      value: forbiddenTargetExecutions === 0 ? 1 : 0,
      unit: 'cases',
    },
    { name: 'durable_non_workspace_target_rejections', value: 1, unit: 'cases' },
    { name: 'governed_worker_templates', value: 1, unit: 'templates' },
    { name: 'fresh_mutation_executions', value: scenarioMutationExecutions, unit: 'mutations' },
    { name: 'restart_mutation_replays', value: 0, unit: 'mutations' },
    { name: 'verified_worker_evidence_refs', value: workerEvidence.length, unit: 'artifacts' },
    { name: 'verified_worker_tool_facts', value: workerEvidenceProjection.tools.length, unit: 'tools' },
    { name: 'durable_unknown_reconciliations', value: 1, unit: 'runs' },
  ];
};
