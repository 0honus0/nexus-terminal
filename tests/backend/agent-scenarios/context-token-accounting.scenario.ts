import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import type {
  MailboxReaderPort,
  RuntimeParticipantRepositoryPort,
  RuntimeParticipantView,
  RuntimeToolExchangeView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.repository.port';
import type { DelegationView } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { emptyModelContinuations, scope } from './scenario-fixtures';
import { contextService, entry } from './scenario-context-helpers';

export const contextTokenAccountingScenario = async () => {
  const anchorService = contextService([
    entry(1, 'user_input', { text: 'Summarize the repository state.' }),
    entry(2, 'assistant_message', { text: 'Previous summary.' }),
  ]);
  const anchorInput = {
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue with the summary.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  } as const;
  const unanchored = await anchorService.compose(anchorInput);
  const anchorDelta = 320;
  const anchored = await anchorService.compose({
    ...anchorInput,
    usageAnchor: {
      heuristicInputTokens: unanchored.estimatedInputTokens,
      providerInputTokens: unanchored.estimatedInputTokens + anchorDelta,
    },
  } as Parameters<ContextService['compose']>[0] & {
    usageAnchor: { heuristicInputTokens: number; providerInputTokens: number };
  });
  assert.equal(
    anchored.estimatedInputTokens,
    unanchored.estimatedInputTokens + anchorDelta,
    'provider actual usage must shift the next same-lineage context estimate by the prior estimator error',
  );

  const telemetryPlan = await contextService([
    entry(1, 'assistant_message', {
      text: '',
      toolCalls: [{ id: 'telemetry-call', name: 'file_search', argumentsJson: '{"query":"needle"}' }],
    }),
    entry(2, 'tool_result', { toolCallId: 'telemetry-call', content: 'matched content' }),
  ]).compose(anchorInput);
  assert.ok(telemetryPlan.tokenDiagnostics.stableInstructionTokens > 0);
  assert.ok(telemetryPlan.tokenDiagnostics.rawHistoryTokens > 0);
  assert.ok(
    telemetryPlan.tokenDiagnostics.toolExchangeTokens > 0 &&
      telemetryPlan.tokenDiagnostics.toolExchangeTokens <= telemetryPlan.tokenDiagnostics.rawHistoryTokens,
    'context token diagnostics must expose Tool exchange cost as a bounded subset of raw history',
  );

  const runtime: RuntimeParticipantView = {
    id: 'subagent-context-runtime',
    runId: 'subagent-context-run',
    participantId: 'child:subagent-context-delegation',
    backendKind: 'native',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    status: 'running',
    scheduleState: 'runnable',
    consumedMailboxSequence: 0,
  };
  let subagentToolArguments: JsonValue = { query: 'small' };
  const runtimes = {
    runtime: async () => runtime,
    recentRuntimeToolExchanges: async (): Promise<RuntimeToolExchangeView[]> => [
      {
        sourceModelStepId: 'subagent-model-step',
        batchIndex: 0,
        batchSize: 1,
        providerCallId: 'subagent-provider-call',
        toolName: 'file_search',
        arguments: subagentToolArguments,
        result: {
          ok: true,
          summary: 'done',
          artifactRefs: [],
          truncated: false,
          outcome: 'confirmed',
          verification: { status: 'verified', summary: 'fixture', evidenceRefs: [] },
        },
        status: 'succeeded',
      },
    ],
  } as unknown as RuntimeParticipantRepositoryPort;
  const mailboxes = {
    readMessages: async () => [],
    listDelegationMessages: async () => [],
  } as MailboxReaderPort;
  const subagentContext = new SubagentContextBuilder(
    runtimes,
    mailboxes,
    { discover: () => [] } as unknown as ToolCatalog,
    new CapabilityRegistry(),
    emptyModelContinuations,
    null!,
    { nowUnixSeconds: () => 1_800_000_000 } as ClockPort,
  );
  const delegation = {
    id: 'subagent-context-delegation',
    runId: 'subagent-context-run',
    parentRuntimeId: 'root-runtime',
    childRuntimeId: runtime.id,
    profileId: 'default',
    grants: [],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef: runtime.modelRef,
    objective: 'Inspect the repository.',
    constraints: [],
    inputArtifactRefs: [],
    completionCriteria: [],
    dependencyMode: 'settled',
    status: 'running',
    depth: 1,
    failureMode: 'isolate',
    budget: { maxSteps: 8 },
    usage: { tokens: 0, steps: 0 },
    result: null,
    evidenceRefs: [],
    deadlineAt: 1_900_000_000,
    version: 1,
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_000,
    completedAt: null,
    ...scope,
  } satisfies DelegationView;
  const subagentRun = {
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    },
    budget: { maxRunSteps: 32, maxToolOutputBytes: 65_536, contextPolicy: freezeRunContextPolicy('normal') },
    definition: { environment: null },
  } as unknown as RunView;
  const subagentModel = {
    id: 'scenario-model',
    contextWindow: 16_384,
    maxOutputTokens: 2_048,
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  } as Parameters<SubagentContextBuilder['prepare']>[4];
  const smallSubagent = await subagentContext.prepare(
    scope,
    'subagent-context-run',
    runtime.id,
    delegation,
    subagentModel,
    subagentRun,
  );
  assert.equal(smallSubagent.kind, 'ready');
  subagentToolArguments = { patch: '界'.repeat(4_000), code: 'const value = '.repeat(200) };
  const largeSubagent = await subagentContext.prepare(
    scope,
    'subagent-context-run',
    runtime.id,
    delegation,
    subagentModel,
    subagentRun,
  );
  assert.equal(largeSubagent.kind, 'ready');
  if (smallSubagent.kind !== 'ready' || largeSubagent.kind !== 'ready') throw new Error('SCENARIO_INVALID');
  const subagentArgumentDelta = largeSubagent.plan.estimatedInputTokens - smallSubagent.plan.estimatedInputTokens;
  assert.ok(
    subagentArgumentDelta > 500,
    'Subagent model accounting must include bounded assistant Tool-call arguments, including CJK/code/JSON payloads',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-context-token-accounting-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'context-token-accounting.sqlite',
    nodeEnv: 'test',
  });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_050_000;
  const runId = 'context-token-accounting-run';
  const runtimeId = 'context-token-accounting-runtime';
  const primaryModel = { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 };
  const fallbackModel = { providerId: 'scenario-provider', modelId: 'scenario-fallback', configurationVersion: 1 };
  const primaryCapabilities = {
    contextWindow: 16_384,
    maxOutputTokens: 2_048,
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  };
  const fallbackCapabilities = { ...primaryCapabilities, contextWindow: 32_768 };
  const budget = JSON.stringify({
    maxRunSteps: 16,
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
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    requiredModelCapabilities: [],
    model: primaryModel,
    modelCapabilities: primaryCapabilities,
    rootModelRoutes: [{ model: fallbackModel, modelCapabilities: fallbackCapabilities }],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 1_000,
    outputTokens: 100,
    cachedInputTokens: 250,
    steps: 2,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'context-token-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('context-token-thread', 1, 'scenario-app', 'context token accounting', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'context-token-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'context-token-owner', ?, ?)`,
      [runtimeId, runId, JSON.stringify(primaryModel), now, now],
    );

    const begun = await stateCommit.beginModelStep({
      scope,
      runId,
      runtimeId,
      expectedRunVersion: 1,
      inputWatermark: 0,
      reservedTokens: 768,
      estimatedInputTokens: 512,
      heuristicInputTokens: 192,
      contextSource: 'anchored_estimate',
      reservedOutputTokens: 256,
      contextWindowTokens: 16_384,
      contextEpoch: 'context-token-primary-epoch',
      model: primaryModel,
      now: now + 1,
    });
    assert.deepEqual(begun.run.usage.context, {
      inputTokens: 512,
      heuristicInputTokens: 192,
      reservedOutputTokens: 256,
      contextWindowTokens: 16_384,
      source: 'anchored_estimate',
      model: primaryModel,
      contextEpoch: 'context-token-primary-epoch',
      updatedAt: now + 1,
    });
    const changed = await stateCommit.changeModelRoute({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: begun.attemptId,
      expectedRunVersion: begun.run.version,
      fromModel: primaryModel,
      toModel: fallbackModel,
      toRouteIndex: 1,
      reservedTokens: 1_024,
      estimatedInputTokens: 700,
      heuristicInputTokens: 680,
      contextSource: 'estimated',
      reservedOutputTokens: 324,
      contextWindowTokens: 32_768,
      contextEpoch: 'context-token-fallback-epoch',
      usage: begun.run.usage,
      inputTokens: 600,
      outputTokens: 10,
      cachedInputTokens: 100,
      estimatedUsage: false,
      errorCode: 'PROVIDER_UNAVAILABLE',
      now: now + 2,
    });
    assert.deepEqual(
      changed.run.usage.context,
      {
        inputTokens: 700,
        heuristicInputTokens: 680,
        reservedOutputTokens: 324,
        contextWindowTokens: 32_768,
        source: 'estimated',
        model: fallbackModel,
        contextEpoch: 'context-token-fallback-epoch',
        updatedAt: now + 2,
      },
      'route failover must replace the previous route context projection before the next attempt',
    );

    const settled = await stateCommit.settleModelStep({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: changed.attemptId,
      expectedRunVersion: changed.run.version,
      assistantEntryId: 'context-token-final',
      assistantText: 'Done.',
      usage: changed.run.usage,
      inputTokens: 845,
      outputTokens: 25,
      cachedInputTokens: 200,
      estimatedUsage: false,
      finishReason: 'stop',
      terminalStatus: 'completed_unverified',
      now: now + 3,
    });
    assert.deepEqual(
      settled.run.usage.context,
      {
        inputTokens: 845,
        heuristicInputTokens: 680,
        reservedOutputTokens: 324,
        contextWindowTokens: 32_768,
        source: 'provider',
        model: fallbackModel,
        contextEpoch: 'context-token-fallback-epoch',
        updatedAt: now + 3,
      },
      'provider input usage must become the latest prompt context occupancy without changing cumulative usage semantics',
    );
    assert.equal(settled.run.usage.inputTokens, 2_445, 'cumulative input usage must remain cumulative across attempts');

    return [
      { name: 'anchor_delta_tokens', value: anchorDelta, unit: 'tokens' },
      { name: 'subagent_tool_argument_delta', value: subagentArgumentDelta, unit: 'tokens' },
      { name: 'provider_context_tokens', value: settled.run.usage.context?.inputTokens ?? 0, unit: 'tokens' },
      { name: 'cumulative_input_tokens', value: settled.run.usage.inputTokens, unit: 'tokens' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
