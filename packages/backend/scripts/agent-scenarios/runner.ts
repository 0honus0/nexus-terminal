import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { LocalArtifactStore } from '../../src/infrastructure/agent/artifacts/local-artifact-store';
import { AgentMutationLeaseGuardAdapter } from '../../src/infrastructure/agent/capabilities/agent-mutation-lease-guard.adapter';
import { SqliteLeaseRepository } from '../../src/infrastructure/agent/repositories/sqlite-lease.repository';
import { SqliteRunRepository } from '../../src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteSubagentRepository } from '../../src/infrastructure/agent/repositories/sqlite-subagent.repository';
import { SqliteStateCommitAdapter } from '../../src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../src/infrastructure/database/database.adapter';
import type { ClockPort, Scope } from '../../src/modules/agent/agent.types';
import type { LeasePort } from '../../src/modules/agent/capabilities/lease.port';
import { ToolCatalog } from '../../src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../src/modules/agent/capabilities/tool-executor';
import type { AgentTool, ToolContext, ToolInspection } from '../../src/modules/agent/capabilities/tool.types';
import type { AppCapabilityBroker } from '../../src/modules/agent/host/app-capability-broker';
import type { AgentSettingsService } from '../../src/modules/agent/host/agent-settings.service';
import { ContextService } from '../../src/modules/agent/ai/context.service';
import type { ArtifactLimitPolicyPort } from '../../src/modules/agent/ai/artifact.port';
import type { IntegrationRepositoryPort } from '../../src/modules/agent/ai/integration.repository.port';
import { IntegrationService } from '../../src/modules/agent/ai/integration.service';
import type { IntegrationServiceHooks } from '../../src/modules/agent/ai/integration.service';
import type { IntegrationView, McpRuntimePort } from '../../src/modules/agent/ai/integrations.types';
import type {
  AppendLedgerEntry,
  ConversationRepositoryPort,
  LedgerEntryView,
  LedgerPage,
  ThreadDeleteAllResult,
  ThreadDeleteResult,
  ThreadPage,
  ThreadTitleSource,
  ThreadView,
} from '../../src/modules/agent/ai/conversation.repository.port';
import { ConversationService } from '../../src/modules/agent/ai/conversation.service';
import { RecallService } from '../../src/modules/agent/ai/recall.service';
import type { RecallCandidate, RecallRepositoryPort } from '../../src/modules/agent/ai/recall.repository.port';
import { SkillRegistry } from '../../src/modules/agent/ai/skill-registry';
import type { ContextHistoryBoundary } from '../../src/modules/agent/ai/context.types';
import type { AgentBackendPort } from '../../src/modules/agent/runtime/execution/agent-backend.port';
import type { MutationLeaseGuardHandle } from '../../src/modules/agent/runtime/execution/mutation-lease-guard.port';
import { ToolCallRunner } from '../../src/modules/agent/runtime/execution/tool-call-runner';
import { AgentEventHub } from '../../src/modules/agent/runtime/events/event-hub';
import { AgentScheduler } from '../../src/modules/agent/runtime/scheduling/scheduler';
import { SubagentParticipantExecutor } from '../../src/modules/agent/runtime/collaboration/subagent-participant-executor';
import { SubagentScheduler } from '../../src/modules/agent/runtime/collaboration/subagent-scheduler';
import type { DelegationView } from '../../src/modules/agent/runtime/collaboration/subagent.types';
import type { RunView } from '../../src/modules/agent/runtime/runs/run.types';
import { agentRoute } from '../../src/interfaces/http/agent/agent-http';
import { parseBudgetIncreaseRequest } from '../../src/interfaces/http/agent/agent-runtime-route-input';

interface ScenarioMetric {
  name: string;
  value: number;
  unit: string;
}

interface ScenarioResult {
  name: string;
  durationMs: number;
  metrics: ScenarioMetric[];
}

type Scenario = () => Promise<ScenarioMetric[]>;

const scope: Scope = { userId: 1, appId: 'scenario-app' };
const clock: ClockPort = { nowUnixSeconds: () => 1_800_000_000 };

class StaticConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly entries: LedgerEntryView[]) {}

  async createThread(
    _scope: Scope,
    _id: string,
    _title: string,
    _titleSource: ThreadTitleSource,
    _now: number,
  ): Promise<ThreadView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async renameThread(
    _scope: Scope,
    _threadId: string,
    _title: string,
    _expectedVersion: number,
    _now: number,
  ): Promise<ThreadView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async getThread(_scope: Scope, _threadId: string): Promise<ThreadView | null> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async listThreads(_scope: Scope, _limit: number, _before?: string): Promise<ThreadPage> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async deleteThread(
    _scope: Scope,
    _threadId: string,
    _expectedVersion: number,
    _now: number,
  ): Promise<ThreadDeleteResult> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async deleteAllThreads(_scope: Scope, _now: number): Promise<ThreadDeleteAllResult> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async readEntries(_scope: Scope, _threadId: string, limit: number, _before?: string): Promise<LedgerPage> {
    return { items: this.entries.slice(-limit), nextCursor: null };
  }

  async readOldestEntries(_scope: Scope, _threadId: string, limit: number): Promise<LedgerPage> {
    return { items: this.entries.slice(0, limit), nextCursor: null };
  }

  async readContextEntries(
    _scope: Scope,
    _threadId: string,
    _runId: string,
    _historyBoundary: ContextHistoryBoundary,
    limit: number,
  ): Promise<LedgerPage> {
    return { items: this.entries.slice(-limit), nextCursor: null };
  }

  async appendEntry(_scope: Scope, _threadId: string, _entry: AppendLedgerEntry): Promise<LedgerEntryView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }
}

class EmptyRecallRepository implements RecallRepositoryPort {
  async publishedCandidates(_scope: Scope, _now: number, _scanLimit: number): Promise<RecallCandidate[]> {
    return [];
  }
}

const entry = (
  sequence: number,
  kind: LedgerEntryView['kind'],
  payload: LedgerEntryView['payload'],
): LedgerEntryView => ({
  id: `entry-${sequence}`,
  threadId: 'scenario-thread',
  runId: 'scenario-run',
  sequence,
  kind,
  payload,
  createdAt: 1_800_000_000 + sequence,
});

const contextService = (entries: LedgerEntryView[]): ContextService => {
  const repository = new StaticConversationRepository(entries);
  // These collaborators are used only by mutation/thread-creation paths; scenarios below exercise real read projection.
  const conversations = new ConversationService(repository, clock, null!, null!);
  const recall = new RecallService(new EmptyRecallRepository(), clock);
  return new ContextService(conversations, recall, new SkillRegistry());
};

const assertValidToolExchange = (messages: Awaited<ReturnType<ContextService['compose']>>['messages']): void => {
  const visibleCalls = new Map<string, number>();
  const resultIds = new Set<string>();
  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) visibleCalls.set(call.id, index);
    }
    if (message.role === 'tool' && message.toolCallId) {
      const assistantIndex = visibleCalls.get(message.toolCallId);
      assert.notEqual(assistantIndex, undefined, `orphan tool result ${message.toolCallId}`);
      assert.ok(assistantIndex! < index, `tool result ${message.toolCallId} must follow its assistant call`);
      resultIds.add(message.toolCallId);
    }
  });
  for (const callId of visibleCalls.keys()) {
    assert.ok(resultIds.has(callId), `assistant tool call ${callId} must retain its terminal result`);
  }
};

const contextToolExchangeScenario: Scenario = async () => {
  const largeArguments = JSON.stringify({ path: '/workspace/work/example.ts', patch: 'x'.repeat(2_048) });
  const service = contextService([
    entry(1, 'user_input', { text: 'Inspect the repository and fix the issue.' }),
    entry(2, 'assistant_message', {
      text: '',
      toolCalls: [
        { id: 'call-a', name: 'workspace_read_file', argumentsJson: largeArguments },
        { id: 'call-b', name: 'workspace_search', argumentsJson: JSON.stringify({ query: 'needle' }) },
      ],
    }),
    entry(3, 'tool_result', { toolCallId: 'call-a', content: 'file contents '.repeat(24) }),
    entry(4, 'tool_result', { toolCallId: 'call-b', content: 'search result '.repeat(24) }),
    entry(5, 'assistant_message', { text: 'I found the relevant call sites.' }),
  ]);

  let compactedRuns = 0;
  for (const budget of [273, 320, 384, 512, 768, 1_024]) {
    const plan = await service.compose({
      scope,
      threadId: 'scenario-thread',
      runId: 'scenario-run',
      currentInput: 'Continue with the fix.',
      modelContextWindow: 4_096,
      maxContextTokens: budget,
      reservedOutputTokens: 128,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      compactionMode: 'balanced',
      tools: [],
    });
    assertValidToolExchange(plan.messages);
    if (plan.compacted) compactedRuns += 1;
  }

  const fullPlan = await service.compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue with the fix.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  const assistantDiagnostic = fullPlan.messageDiagnostics.find(
    (diagnostic) => diagnostic.role === 'assistant' && diagnostic.estimatedTokens > 100,
  );
  assert.ok(assistantDiagnostic, 'structured tool-call arguments must contribute to token accounting');

  return [
    { name: 'budget_variants', value: 6, unit: 'cases' },
    { name: 'compacted_variants', value: compactedRuns, unit: 'cases' },
    { name: 'tool_argument_estimate', value: assistantDiagnostic.estimatedTokens, unit: 'tokens' },
  ];
};

const restartRecoveryScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'restart.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const leases = new SqliteLeaseRepository(db);
  const now = 1_800_000_000;

  const budget = JSON.stringify({
    maxContextTokens: 16_384,
    maxOutputTokens: 4_096,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const plan = JSON.stringify({ schemaVersion: 1, revision: 0, items: [] });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });

  const insertRun = async (id: string, threadId: string, runtimeId: string): Promise<void> => {
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'manual', ?, ?)`,
      [threadId, threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'not_started', ?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, threadId, budget, definition, plan, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [runtimeId, id, modelRef, `owner-${runtimeId}`, now, now],
    );
  };

  const toolInspection = (
    toolName: string,
    resourceKey: string,
    risk: 'read' | 'mutate',
    operationHash: string,
  ): string =>
    JSON.stringify({
      toolName,
      toolVersion: '1',
      normalizedArguments: { path: '/workspace/example.txt' },
      target: {
        kind: 'workspace',
        targetIdentity: 'scenario-workspace',
        endpoint: '',
        loginUser: '',
        configurationHash: 'scenario',
        workspaceId: 'scenario-workspace',
        generation: 1,
      },
      resourceKeys: [resourceKey],
      risk,
      mutation: risk === 'mutate',
      operationHash,
      operationHashVersion: 1,
      preconditions: [],
      secretRefs: [],
      policyRevision: 1,
      inputRevision: 0,
    });

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'scenario-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 3, ?, ?)`,
      [now, now],
    );

    await insertRun('model-run', 'model-thread', 'model-runtime');
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('model-step', 'model-run', 'model-runtime', 1, 'model', 'running', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_model_attempts
        (id, step_id, attempt_index, status, reserved_tokens, created_at)
       VALUES ('model-attempt', 'model-step', 1, 'streaming', 4096, ?)`,
      [now],
    );

    await insertRun('read-run', 'read-thread', 'read-runtime');
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('read-step', 'read-run', 'read-runtime', 1, 'tool', 'running', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, created_at, started_at)
       VALUES ('read-tool', 'read-run', 'read-runtime', 'read-step', 'provider-read', 'workspace_read_file', '1',
               ?, 'sha256:read', 1, 'read', 'running', ?, ?)`,
      [toolInspection('workspace_read_file', 'workspace:read', 'read', 'sha256:read'), now, now],
    );

    await insertRun('mutation-run', 'mutation-thread', 'mutation-runtime');
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('mutation-step', 'mutation-run', 'mutation-runtime', 1, 'tool', 'running', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, created_at, started_at)
       VALUES ('mutation-tool', 'mutation-run', 'mutation-runtime', 'mutation-step', 'provider-mutation',
               'workspace_write_file', '1', ?, 'sha256:mutation', 1, 'mutate', 'running', ?, ?)`,
      [toolInspection('workspace_write_file', 'workspace:mutation', 'mutate', 'sha256:mutation'), now, now],
    );
    await db.execute(
      "INSERT INTO agent_resource_fences (resource_key, next_fence) VALUES ('workspace:mutation', 2)",
    );
    await db.execute(
      `INSERT INTO agent_leases
        (id, resource_key, mode, owner_type, owner_id, fence, acquired_at, expires_at, active_mutation, operation_id)
       VALUES ('mutation-lease', 'workspace:mutation', 'write', 'agent', 'mutation-runtime', 1, ?, ?, 1, 'mutation-tool')`,
      [now, now + 300],
    );

    const interrupted = await stateCommit.interruptNonTerminalRuns(now + 1);
    assert.equal(interrupted, 3);

    const modelAttempt = await db.queryOne<{ status: string; completed_at: number | null; error_code: string | null }>(
      "SELECT status, completed_at, error_code FROM agent_model_attempts WHERE id = 'model-attempt'",
    );
    assert.deepEqual(modelAttempt, { status: 'aborted', completed_at: now + 1, error_code: 'BACKEND_RESTART' });
    const modelStep = await db.queryOne<{ status: string; completed_at: number | null }>(
      "SELECT status, completed_at FROM agent_steps WHERE id = 'model-step'",
    );
    assert.deepEqual(modelStep, { status: 'cancelled', completed_at: now + 1 });

    const readTool = await db.queryOne<{ status: string; completed_at: number | null }>(
      "SELECT status, completed_at FROM agent_tool_calls WHERE id = 'read-tool'",
    );
    assert.deepEqual(readTool, { status: 'cancelled', completed_at: now + 1 });
    const readStep = await db.queryOne<{ status: string; completed_at: number | null }>(
      "SELECT status, completed_at FROM agent_steps WHERE id = 'read-step'",
    );
    assert.deepEqual(readStep, { status: 'cancelled', completed_at: now + 1 });

    const mutationRun = await db.queryOne<{ version: number; needs_reconciliation: number; status: string }>(
      "SELECT version, needs_reconciliation, status FROM agent_runs WHERE id = 'mutation-run'",
    );
    assert.deepEqual(mutationRun, { version: 2, needs_reconciliation: 1, status: 'interrupted' });
    const quarantine = await db.queryOne<{
      resource_key: string;
      tool_call_id: string | null;
      reason: string;
      version: number;
    }>(
      "SELECT resource_key, tool_call_id, reason, version FROM agent_resource_quarantine WHERE resource_key = 'workspace:mutation'",
    );
    assert.deepEqual(quarantine, {
      resource_key: 'workspace:mutation',
      tool_call_id: 'mutation-tool',
      reason: 'BACKEND_RESTART_DURING_MUTATION',
      version: 1,
    });
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_tool_calls WHERE id = 'mutation-tool'"))?.status,
      'reconciling',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_steps WHERE id = 'mutation-step'"))?.status,
      'failed',
    );

    await assert.rejects(
      leases.acquireMany({ type: 'system', id: 'before-reconcile' }, ['workspace:mutation'], 'write', 30),
      (error: unknown) => error instanceof Error && error.message === 'RESOURCE_QUARANTINED',
    );

    await stateCommit.resolveRunReconciliation({
      scope,
      runId: 'mutation-run',
      expectedRunVersion: 2,
      note: 'scenario verified the external mutation outcome',
      resources: [{ resourceKey: quarantine!.resource_key, version: quarantine!.version }],
      now: now + 2,
    });
    assert.equal(
      await db.queryOne("SELECT resource_key FROM agent_resource_quarantine WHERE resource_key = 'workspace:mutation'"),
      null,
    );
    assert.equal(await db.queryOne("SELECT id FROM agent_leases WHERE id = 'mutation-lease'"), null);
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_tool_calls WHERE id = 'mutation-tool'"))?.status,
      'failed',
    );
    const resolvedRun = await db.queryOne<{ version: number; needs_reconciliation: number }>(
      "SELECT version, needs_reconciliation FROM agent_runs WHERE id = 'mutation-run'",
    );
    assert.deepEqual(resolvedRun, { version: 3, needs_reconciliation: 0 });

    const probe = await leases.acquireMany({ type: 'system', id: 'after-reconcile' }, ['workspace:mutation'], 'write', 30);
    assert.equal(probe.length, 1);
    await leases.release(
      probe.map((lease) => lease.id),
      { type: 'system', id: 'after-reconcile' },
    );

    const deleted = await stateCommit.deleteRun({
      scope,
      runId: 'mutation-run',
      expectedRunVersion: 3,
      idempotencyKey: 'scenario-delete-mutation',
      requestHash: 'scenario-delete-mutation-v1',
      now: now + 3,
    });
    assert.equal(deleted.deleted, true);
    assert.equal(await db.queryOne("SELECT id FROM agent_runs WHERE id = 'mutation-run'"), null);

    return [
      { name: 'interrupted_runs', value: interrupted, unit: 'runs' },
      { name: 'materialized_quarantines', value: 1, unit: 'resources' },
      { name: 'resolved_mutations', value: 1, unit: 'tools' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const appDisableScopeScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-disable-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'disable.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_800_100_000;
  const budget = JSON.stringify({
    maxContextTokens: 16_384,
    maxOutputTokens: 4_096,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const plan = JSON.stringify({ schemaVersion: 1, revision: 0, items: [] });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });

  const insertApp = async (userId: number, appId: string): Promise<void> => {
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (?, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [userId, appId, now, now],
    );
  };
  const insertRun = async (
    userId: number,
    appId: string,
    runId: string,
    threadId: string,
    runtimeId: string,
  ): Promise<void> => {
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?)`,
      [threadId, userId, appId, threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', 'in_progress', 'not_started', ?, ?, ?, ?, 1, ?, ?, ?)`,
      [runId, userId, appId, threadId, budget, definition, plan, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [runtimeId, runId, modelRef, `owner-${runtimeId}`, now, now],
    );
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'disable-user-1', 'not-used')");
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (2, 'disable-user-2', 'not-used')");
    await insertApp(1, 'scope-app-a');
    await insertApp(1, 'scope-app-b');
    await insertApp(2, 'scope-app-a');
    await insertRun(1, 'scope-app-a', 'scope-run-target', 'scope-thread-target', 'scope-root-target');
    await insertRun(1, 'scope-app-b', 'scope-run-other-app', 'scope-thread-other-app', 'scope-root-other-app');
    await insertRun(2, 'scope-app-a', 'scope-run-other-user', 'scope-thread-other-user', 'scope-root-other-user');

    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('scope-child-target', 'scope-run-target', 'child:1', 'native', ?, 'running', 'executing', 0,
               'owner-scope-child-target', ?, ?)`,
      [modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, capabilities_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, created_at, updated_at)
       VALUES ('scope-delegation-target', 'scope-run-target', 'scope-root-target', 'scope-child-target', 'default',
               '[]', 'parent-child', ?, 'scenario child', '[]', '[]', '[]', 'settled', 'running', 1, 'isolate',
               10, 'scope-delegation-key', 'scope-delegation-hash', ?, ?, ?)`,
      [modelRef, now + 600, now, now],
    );
    await db.execute(
      `INSERT INTO agent_scheduler_work
        (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before, deadline_at,
         created_at, updated_at)
       VALUES ('scope-work-target', 'scope-run-target', 'scope-child-target', 'model_step', 'claimed', '{}',
               123, ?, ?, ?, ?)`,
      [now, now + 600, now, now],
    );

    const quiesced = await stateCommit.quiesceApp({ userId: 1, appId: 'scope-app-a' }, now + 1);
    assert.equal(quiesced, 1);
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_runs WHERE id = 'scope-run-target'"))?.status,
      'interrupted',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_runs WHERE id = 'scope-run-other-app'"))?.status,
      'running',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_runs WHERE id = 'scope-run-other-user'"))?.status,
      'running',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>(
        "SELECT status FROM agent_delegations WHERE id = 'scope-delegation-target'",
      ))?.status,
      'cancelled',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_scheduler_work WHERE id = 'scope-work-target'"))
        ?.status,
      'cancelled',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_runtimes WHERE id = 'scope-child-target'"))
        ?.status,
      'stopped',
    );
    assert.equal(
      (await db.queryOne<{ running_count: number }>(
        "SELECT running_count FROM agent_apps WHERE user_id = 1 AND app_id = 'scope-app-a'",
      ))?.running_count,
      0,
    );
    assert.equal(
      (await db.queryOne<{ running_count: number }>(
        "SELECT running_count FROM agent_apps WHERE user_id = 2 AND app_id = 'scope-app-a'",
      ))?.running_count,
      1,
    );
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const started: string[] = [];
  const aborted: string[] = [];
  const schedulerClock: ClockPort = {
    nowUnixSeconds: () => Math.floor(Date.now() / 1000),
    nowUnixMilliseconds: () => Date.now(),
  };
  const backend: AgentBackendPort = {
    async *execute(run, signal) {
      started.push(run.id);
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (signal.aborted) aborted.push(run.id);
    },
  };
  const settings = {
    get: async () => ({
      effectiveSettings: {
        performance: { maxConcurrentRuntimes: 8 },
        hardLimits: { maxConcurrentRuntimes: 8 },
      },
    }),
  } as unknown as AgentSettingsService;
  const scheduler = new AgentScheduler(
    settings,
    backend,
    new AgentEventHub(),
    schedulerClock,
    async () => 0,
  );
  const makeRun = (userId: number, appId: string, id: string): RunView => ({
    id,
    userId,
    appId,
    threadId: `thread-${id}`,
    parentRunId: null,
    status: 'running',
    goalStatus: 'in_progress',
    goal: { text: 'scenario', revision: 1, updatedAt: now },
    verificationStatus: 'not_started',
    needsReconciliation: false,
    budget: JSON.parse(budget),
    definition: JSON.parse(definition),
    plan: JSON.parse(plan),
    usage: JSON.parse(usage),
    activeExecutionSeconds: 0,
    activeExecutionStartedAt: now,
    executingRuntimeCount: 1,
    consumedInputSequence: 0,
    inputRevision: 0,
    eventCursor: 0,
    version: 1,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
  });
  const target = makeRun(1, 'scope-app-a', 'scheduler-target');
  const otherApp = makeRun(1, 'scope-app-b', 'scheduler-other-app');
  const otherUser = makeRun(2, 'scope-app-a', 'scheduler-other-user');
  scheduler.enqueue(target);
  scheduler.enqueue(otherApp);
  scheduler.enqueue(otherUser);
  for (let index = 0; index < 100 && started.length < 3; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.deepEqual(new Set(started), new Set([target.id, otherApp.id, otherUser.id]));

  await scheduler.quiesceScope({ userId: 1, appId: 'scope-app-a' }, schedulerClock.nowUnixSeconds() + 2);
  assert.ok(aborted.includes(target.id));
  assert.ok(!aborted.includes(otherApp.id));
  assert.ok(!aborted.includes(otherUser.id));
  assert.equal(scheduler.hasActiveRun(target.id), false);
  assert.equal(scheduler.hasActiveRun(otherApp.id), true);
  assert.equal(scheduler.hasActiveRun(otherUser.id), true);

  const pausedRun = makeRun(1, 'scope-app-a', 'scheduler-paused');
  scheduler.enqueue(pausedRun);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(!started.includes(pausedRun.id));
  scheduler.resumeScope({ userId: 1, appId: 'scope-app-a' });
  scheduler.enqueue(pausedRun);
  for (let index = 0; index < 100 && !started.includes(pausedRun.id); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.ok(started.includes(pausedRun.id));
  await scheduler.quiesce(schedulerClock.nowUnixSeconds() + 2);

  return [
    { name: 'durable_scope_quiesced', value: 1, unit: 'runs' },
    { name: 'unaffected_scopes', value: 2, unit: 'runs' },
    { name: 'scheduler_scope_aborts', value: 1, unit: 'runs' },
  ];
};

const readToolBatchAuthorityScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-read-batch-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'read-batch.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_800_200_000;
  const budget = JSON.stringify({
    maxContextTokens: 16_384,
    maxOutputTokens: 4_096,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const plan = JSON.stringify({ schemaVersion: 1, revision: 0, items: [] });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const result = (summary: string) => ({
    ok: true,
    summary,
    data: { summary },
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed' as const,
    verification: { status: 'verified' as const, summary: 'scenario verified', evidenceRefs: [] },
  });

  const insertTool = async (stepIndex: number, suffix: string): Promise<{ toolStepId: string; toolCallId: string }> => {
    const toolStepId = `read-batch-step-${suffix}`;
    const toolCallId = `read-batch-tool-${suffix}`;
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES (?, 'read-batch-run', 'read-batch-runtime', ?, 'tool', 'created', 0, '[]', '[]', ?)`,
      [toolStepId, stepIndex, now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, created_at)
       VALUES (?, 'read-batch-run', 'read-batch-runtime', ?, ?, 'workspace_read_file', '1', '{}', ?, 1,
               'read', 'proposed', ?)`,
      [toolCallId, toolStepId, `provider-${suffix}`, `hash-${suffix}`, now],
    );
    return { toolStepId, toolCallId };
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'read-batch-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'read-batch-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('read-batch-thread', 1, 'read-batch-app', 'read batch', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES ('read-batch-run', 1, 'read-batch-app', 'read-batch-thread', 'running', 'in_progress', 'not_started',
               ?, ?, ?, ?, 1, ?, ?, ?)`,
      [budget, definition, plan, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('read-batch-runtime', 'read-batch-run', 'root', 'native', ?, 'running', 'executing', 0,
               'owner-read-batch-runtime', ?, ?)`,
      [modelRef, now, now],
    );

    const single = await insertTool(1, 'single');
    const singleBegun = await stateCommit.beginReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 1,
      items: [single],
      now: now + 1,
    });
    assert.equal(singleBegun.run.version, 2);
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_tool_calls WHERE id = 'read-batch-tool-single'"))
        ?.status,
      'running',
    );
    const singleSettled = await stateCommit.settleReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 2,
      items: [
        {
          ...single,
          toolResultEntryId: 'read-batch-entry-single',
          providerCallId: 'provider-single',
          result: result('single result'),
        },
      ],
      now: now + 2,
    });
    assert.equal(singleSettled.run.version, 3);
    assert.equal(singleSettled.run.usage.steps, 1);

    const first = await insertTool(2, 'parallel-a');
    const second = await insertTool(3, 'parallel-b');
    const parallelBegun = await stateCommit.beginReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 3,
      items: [first, second],
      now: now + 3,
    });
    assert.equal(parallelBegun.run.version, 4);
    const parallelSettled = await stateCommit.settleReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 4,
      items: [
        {
          ...first,
          toolResultEntryId: 'read-batch-entry-parallel-a',
          providerCallId: 'provider-parallel-a',
          result: result('parallel result A'),
        },
        {
          ...second,
          toolResultEntryId: 'read-batch-entry-parallel-b',
          providerCallId: 'provider-parallel-b',
          result: result('parallel result B'),
        },
      ],
      now: now + 4,
    });
    assert.equal(parallelSettled.run.version, 5);
    assert.equal(parallelSettled.run.usage.steps, 3);

    const toolRows = await db.queryAll<{ id: string; status: string }>(
      `SELECT id, status FROM agent_tool_calls WHERE run_id = 'read-batch-run' ORDER BY id`,
    );
    assert.equal(toolRows.length, 3);
    assert.ok(toolRows.every((row) => row.status === 'succeeded'));
    const ledgerRows = await db.queryAll<{ kind: string }>(
      `SELECT kind FROM ai_thread_entries WHERE run_id = 'read-batch-run' ORDER BY sequence`,
    );
    assert.equal(ledgerRows.length, 3);
    assert.ok(ledgerRows.every((row) => row.kind === 'tool_result'));

    return [
      { name: 'size_one_batches', value: 1, unit: 'batches' },
      { name: 'parallel_batches', value: 1, unit: 'batches' },
      { name: 'settled_read_tools', value: toolRows.length, unit: 'tools' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const subagentClaimedCancellationScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-subagent-cancel-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'subagent-cancel.sqlite', nodeEnv: 'test' });
  const repository = new SqliteSubagentRepository(db);
  const now = 1_800_300_000;
  const schedulerClock: ClockPort = {
    nowUnixSeconds: () => now,
    nowUnixMilliseconds: () => now * 1_000,
  };
  const scope: Scope = { userId: 1, appId: 'subagent-cancel-app' };
  const runId = 'subagent-cancel-run';
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const budget = JSON.stringify({
    maxContextTokens: 16_384,
    maxOutputTokens: 4_096,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: JSON.parse(modelRef),
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const settings = {
    get: async () => ({
      effectiveSettings: {
        performance: { maxConcurrentRuntimes: 1 },
        hardLimits: { maxConcurrentRuntimes: 1 },
      },
    }),
  } as unknown as AgentSettingsService;

  const insertChild = async (
    suffix: string,
    options: {
      delegationStatus?: 'running' | 'cancelled';
      runtimeStatus?: 'running' | 'stopped';
      scheduleState?: 'runnable' | 'executing' | 'finished';
      workStatus?: 'queued' | 'claimed';
      ownerEpoch?: number | null;
      updatedAt?: number;
    } = {},
  ): Promise<{ runtimeId: string; delegationId: string; workId: string }> => {
    const runtimeId = `subagent-runtime-${suffix}`;
    const delegationId = `subagent-delegation-${suffix}`;
    const workId = `subagent-work-${suffix}`;
    const delegationStatus = options.delegationStatus ?? 'running';
    const runtimeStatus = options.runtimeStatus ?? 'running';
    const scheduleState = options.scheduleState ?? 'runnable';
    const workStatus = options.workStatus ?? 'queued';
    const ownerEpoch = options.ownerEpoch ?? null;
    const updatedAt = options.updatedAt ?? now;
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, ?, 'native', ?, ?, ?, 0, ?, ?, ?)`,
      [runtimeId, runId, `child:${suffix}`, modelRef, runtimeStatus, scheduleState, `owner-${runtimeId}`, now, updatedAt],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, capabilities_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at, completed_at)
       VALUES (?, ?, 'subagent-root-runtime', ?, 'default', '[]', 'parent-child', ?, ?, '[]', '[]', '[]',
               'settled', ?, 1, 'isolate', 10, ?, ?, ?, 1, ?, ?, ?)`,
      [
        delegationId,
        runId,
        runtimeId,
        modelRef,
        `objective-${suffix}`,
        delegationStatus,
        `delegation-key-${suffix}`,
        `delegation-hash-${suffix}`,
        now + 600,
        now,
        updatedAt,
        delegationStatus === 'cancelled' ? updatedAt : null,
      ],
    );
    await db.execute(
      `INSERT INTO agent_scheduler_work
        (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch,
         not_before, deadline_at, created_at, updated_at, version)
       VALUES (?, ?, ?, 'model_step', ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        workId,
        runId,
        runtimeId,
        workStatus,
        JSON.stringify({ delegationId }),
        ownerEpoch,
        now - 1,
        now + 600,
        now - 100,
        updatedAt,
      ],
    );
    return { runtimeId, delegationId, workId };
  };

  let scheduler: SubagentScheduler | null = null;
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'subagent-cancel-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('subagent-cancel-thread', 1, ?, 'subagent cancel', 'manual', ?, ?)`,
      [scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'subagent-cancel-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 1, ?, ?, ?)`,
      [runId, scope.appId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('subagent-root-runtime', ?, 'root', 'native', ?, 'running', 'executing', 0,
               'owner-subagent-root-runtime', ?, ?)`,
      [runId, modelRef, now, now],
    );

    const target = await insertChild('target');
    const next = await insertChild('next');
    const started: string[] = [];
    let targetAborted = false;
    let lateSettleReturned = false;
    const participant = {
      execute: async (_scope: Scope, work: { id: string }, ownerEpoch: number, signal: AbortSignal): Promise<void> => {
        started.push(work.id);
        if (work.id === target.workId) {
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          targetAborted = signal.aborted;
          await repository.settleWork(work.id, ownerEpoch, 'completed', now + 2);
          lateSettleReturned = true;
          return;
        }
        await repository.settleWork(work.id, ownerEpoch, 'completed', now + 3);
      },
      handleTerminalCandidate: async () => undefined,
      handleInboxWake: async () => undefined,
    } as unknown as SubagentParticipantExecutor;
    scheduler = new SubagentScheduler(
      settings,
      repository,
      repository,
      participant,
      {
        activeCountForUser: () => 0,
        hasActiveRun: () => false,
        activeRunIds: () => [],
        enqueueRun: async () => undefined,
        wake: () => undefined,
      },
      schedulerClock,
    );
    await scheduler.initialize();
    for (let index = 0; index < 100 && !started.includes(target.workId); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.ok(started.includes(target.workId), 'target child work must be claimed and executing before cancellation');
    assert.ok(!started.includes(next.workId), 'maxConcurrent=1 must keep the next child queued while target is active');

    const cancelled = await repository.cancelDelegation(scope, runId, target.delegationId, 1, now + 1);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(scheduler.cancelRuntime(runId, target.runtimeId), true);
    for (let index = 0; index < 100 && (!lateSettleReturned || !started.includes(next.workId)); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(targetAborted, true, 'durable cancellation must be followed by an AbortSignal for the active child');
    assert.equal(lateSettleReturned, true, 'a late worker settle must be an idempotent no-op after durable cancellation');
    assert.ok(started.includes(next.workId), 'another child must continue scheduling without a backend restart');
    assert.deepEqual(
      await db.queryOne<{ status: string; owner_epoch: number | null }>(
        'SELECT status, owner_epoch FROM agent_scheduler_work WHERE id = ?',
        [target.workId],
      ),
      { status: 'cancelled', owner_epoch: null },
    );
    assert.equal(
      (await db.queryOne<{ status: string }>('SELECT status FROM agent_delegations WHERE id = ?', [target.delegationId]))
        ?.status,
      'cancelled',
    );

    for (let index = 0; index < 100; index += 1) {
      const status = await db.queryOne<{ status: string }>('SELECT status FROM agent_scheduler_work WHERE id = ?', [next.workId]);
      if (status?.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(
      (await db.queryOne<{ status: string }>('SELECT status FROM agent_scheduler_work WHERE id = ?', [next.workId]))?.status,
      'completed',
    );

    const orphan = await insertChild('orphan', {
      scheduleState: 'executing',
      workStatus: 'claimed',
      ownerEpoch: 777,
      updatedAt: now - 100,
    });
    const terminalOrphan = await insertChild('terminal-orphan', {
      delegationStatus: 'cancelled',
      runtimeStatus: 'stopped',
      scheduleState: 'finished',
      workStatus: 'claimed',
      ownerEpoch: 777,
      updatedAt: now - 100,
    });
    const activeExcluded = await insertChild('active-excluded', {
      scheduleState: 'executing',
      workStatus: 'claimed',
      ownerEpoch: 777,
      updatedAt: now - 100,
    });
    const recovered = await repository.recoverOrphanedClaimedWork(777, [activeExcluded.workId], now - 30, now);
    assert.equal(recovered, 2);
    assert.deepEqual(
      await db.queryOne<{ status: string; owner_epoch: number | null }>(
        'SELECT status, owner_epoch FROM agent_scheduler_work WHERE id = ?',
        [orphan.workId],
      ),
      { status: 'queued', owner_epoch: null },
    );
    assert.deepEqual(
      await db.queryOne<{ status: string; owner_epoch: number | null }>(
        'SELECT status, owner_epoch FROM agent_scheduler_work WHERE id = ?',
        [terminalOrphan.workId],
      ),
      { status: 'cancelled', owner_epoch: null },
    );
    assert.deepEqual(
      await db.queryOne<{ status: string; owner_epoch: number | null }>(
        'SELECT status, owner_epoch FROM agent_scheduler_work WHERE id = ?',
        [activeExcluded.workId],
      ),
      { status: 'claimed', owner_epoch: 777 },
    );

    return [
      { name: 'claimed_abort_signals', value: targetAborted ? 1 : 0, unit: 'workers' },
      { name: 'late_settle_noops', value: lateSettleReturned ? 1 : 0, unit: 'workers' },
      { name: 'same_epoch_orphans_recovered', value: recovered, unit: 'work-items' },
    ];
  } finally {
    if (scheduler) await scheduler.dispose().catch(() => undefined);
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const failFastSiblingCancellationScenario: Scenario = async () => {
  const now = 1_800_400_000;
  const scenarioScope: Scope = { userId: 1, appId: 'fail-fast-app' };
  const baseDelegation = (
    id: string,
    parentRuntimeId: string,
    childRuntimeId: string,
    status: DelegationView['status'],
    failureMode: DelegationView['failureMode'] = 'isolate',
  ): DelegationView => ({
    ...scenarioScope,
    id,
    runId: 'fail-fast-run',
    parentRuntimeId,
    childRuntimeId,
    profileId: 'default',
    capabilities: [],
    peerMessaging: 'parent-child',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    objective: id,
    constraints: [],
    inputArtifactRefs: [],
    completionCriteria: [],
    dependencyMode: 'settled',
    status,
    depth: parentRuntimeId === 'root-runtime' ? 1 : 2,
    failureMode,
    budget: { maxSteps: 10 },
    usage: { tokens: 0, steps: 0 },
    result: null,
    evidenceRefs: [],
    deadlineAt: now + 600,
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'failed' || status === 'cancelled' || status === 'completed' ? now : null,
  });
  const failed = baseDelegation('failed', 'root-runtime', 'failed-runtime', 'failed', 'failFast');
  const sibling = baseDelegation('sibling', 'root-runtime', 'sibling-runtime', 'running');
  const descendant = baseDelegation('descendant', 'sibling-runtime', 'descendant-runtime', 'running');
  const cancelledIds: string[] = [];
  const abortedRuntimeIds: string[] = [];
  const delegations = {
    listDelegations: async () => [failed, sibling],
    descendants: async (_scope: Scope, _runId: string, runtimeId: string) =>
      runtimeId === sibling.childRuntimeId ? [descendant] : [],
    cancelDelegation: async (
      _scope: Scope,
      _runId: string,
      delegationId: string,
      _expectedVersion: number,
      _now: number,
    ) => {
      cancelledIds.push(delegationId);
      const current = delegationId === sibling.id ? sibling : descendant;
      return { ...current, status: 'cancelled' as const, version: current.version + 1, completedAt: now };
    },
  };
  const executor = new SubagentParticipantExecutor(
    null!,
    delegations as never,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    {
      enqueueRootRun: async () => undefined,
      wakeChildScheduler: () => undefined,
      cancelChildRuntime: (_runId, runtimeId) => abortedRuntimeIds.push(runtimeId),
    },
    { nowUnixSeconds: () => now } as ClockPort,
  );
  await (
    executor as unknown as {
      cancelSiblings(scope: Scope, failed: DelegationView): Promise<void>;
    }
  ).cancelSiblings(scenarioScope, failed);

  assert.deepEqual(cancelledIds, [descendant.id, sibling.id]);
  assert.deepEqual(abortedRuntimeIds, [descendant.childRuntimeId, sibling.childRuntimeId]);
  return [
    { name: 'fail_fast_cancelled_delegations', value: cancelledIds.length, unit: 'delegations' },
    { name: 'fail_fast_runtime_aborts', value: abortedRuntimeIds.length, unit: 'runtimes' },
  ];
};

const nestedJoinDurableWakeScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-join-resume-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'join-resume.sqlite', nodeEnv: 'test' });
  const repository = new SqliteSubagentRepository(db);
  const now = 1_800_500_000;
  const scenarioScope: Scope = { userId: 1, appId: 'join-resume-app' };
  const runId = 'join-resume-run';
  const parentRuntimeId = 'join-parent-runtime';
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const budget = JSON.stringify({
    maxContextTokens: 16_384,
    maxOutputTokens: 4_096,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: JSON.parse(modelRef),
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const childA = { runtimeId: 'join-child-a-runtime', delegationId: 'join-child-a' };
  const childB = { runtimeId: 'join-child-b-runtime', delegationId: 'join-child-b' };
  const joinToolCallId = 'join-control-tool-call';
  const hostRootEnqueues: string[] = [];
  const participant = new SubagentParticipantExecutor(
    repository,
    repository,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    new AgentEventHub(),
    {
      enqueueRootRun: async (id) => {
        hostRootEnqueues.push(id);
      },
      wakeChildScheduler: () => undefined,
      cancelChildRuntime: () => undefined,
    },
    { nowUnixSeconds: () => now } as ClockPort,
  );

  const insertDelegation = async (
    id: string,
    parentId: string,
    runtimeId: string,
    objective: string,
  ): Promise<void> => {
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, ?, 'native', ?, 'running', 'runnable', 0, ?, ?, ?)`,
      [runtimeId, runId, `child:${id}`, modelRef, `owner-${runtimeId}`, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, capabilities_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', '[]', 'parent-child', ?, ?, '[]', '[]', '[]', 'settled', 'running',
               2, 'isolate', 10, ?, ?, ?, 1, ?, ?)`,
      [id, runId, parentId, runtimeId, modelRef, objective, `key-${id}`, `hash-${id}`, now + 600, now, now],
    );
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'join-resume-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('join-resume-thread', 1, ?, 'join resume', 'manual', ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'join-resume-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scenarioScope.appId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('join-root-runtime', ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-join-root', ?, ?)`,
      [runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'child:parent', 'native', ?, 'running', 'joining', 0, 'owner-join-parent', ?, ?)`,
      [parentRuntimeId, runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, capabilities_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES ('join-parent-delegation', ?, 'join-root-runtime', ?, 'default', '[]', 'parent-child', ?,
               'nested parent', '[]', '[]', '[]', 'settled', 'running', 1, 'isolate', 20,
               'join-parent-key', 'join-parent-hash', ?, 1, ?, ?)`,
      [runId, parentRuntimeId, modelRef, now + 900, now, now],
    );
    await insertDelegation(childA.delegationId, parentRuntimeId, childA.runtimeId, 'child A');
    await insertDelegation(childB.delegationId, parentRuntimeId, childB.runtimeId, 'child B');

    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('join-control-step', ?, ?, 1, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
      [runId, parentRuntimeId, now, now],
    );
    const joinInspection = {
      toolName: 'join_subagents',
      toolVersion: '1',
      normalizedArguments: {
        delegationIds: [childA.delegationId, childB.delegationId],
        mode: 'all',
        deadlineAt: now + 300,
      },
      target: {
        kind: 'run',
        targetIdentity: `run:${runId}`,
        endpoint: `run:${runId}`,
        loginUser: `agent-runtime:${parentRuntimeId}`,
        configurationHash: 'join-control-hash',
      },
      resourceKeys: [],
      risk: 'control',
      mutation: false,
      operationHash: 'join-control-hash',
      operationHashVersion: 1,
      preconditions: [],
      secretRefs: [],
      policyRevision: 1,
      inputRevision: 0,
    };
    const waitingResult = {
      ok: true,
      summary: 'Subagent join is waiting for child progress.',
      data: { ready: false, settled: [], running: [childA.delegationId, childB.delegationId], timedOut: false },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: { status: 'verified', summary: 'join inspected', evidenceRefs: [] },
    };
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
         created_at, started_at, completed_at)
       VALUES (?, ?, ?, 'join-control-step', 'provider-join-control', 'join_subagents', '1', ?,
               'join-control-hash', 1, 'control', 'succeeded', ?, ?, ?, ?)`,
      [joinToolCallId, runId, parentRuntimeId, JSON.stringify(joinInspection), JSON.stringify(waitingResult), now, now, now],
    );

    // Completion mailbox is intentionally omitted here: durable control wake must be sufficient by itself.
    await repository.cancelDelegation(scenarioScope, runId, childA.delegationId, 1, now + 1);
    let resumeRows = await db.queryAll<{ id: string; status: string; version: number }>(
      `SELECT id, status, version FROM agent_scheduler_work WHERE run_id = ? AND kind = 'join_resume'`,
      [runId],
    );
    assert.deepEqual(resumeRows.map((row) => row.id), [`join-resume:${joinToolCallId}`]);
    assert.equal(resumeRows[0]?.status, 'queued');

    const firstReady = (await repository.readyWork(now + 1, 16)).find((work) => work.kind === 'join_resume');
    assert.ok(firstReady, 'first child terminal must create claimable join_resume work');
    const firstClaim = await repository.claimWork(firstReady.id, firstReady.version, 111, now + 1);
    assert.ok(firstClaim);
    assert.equal(await repository.resetClaimedWork(222, now + 2), 1);
    assert.equal(
      (await db.queryOne<{ schedule_state: string }>('SELECT schedule_state FROM agent_runtimes WHERE id = ?', [parentRuntimeId]))
        ?.schedule_state,
      'joining',
      'scheduler epoch recovery must not bypass join re-check',
    );
    const recoveredReady = (await repository.readyWork(now + 2, 16)).find((work) => work.kind === 'join_resume');
    assert.ok(recoveredReady);
    const recoveredClaim = await repository.claimWork(recoveredReady.id, recoveredReady.version, 222, now + 2);
    assert.ok(recoveredClaim);
    await participant.handleJoinResume(scenarioScope, recoveredClaim, 222);
    assert.equal(
      (await db.queryOne<{ schedule_state: string }>('SELECT schedule_state FROM agent_runtimes WHERE id = ?', [parentRuntimeId]))
        ?.schedule_state,
      'joining',
      'mode=all must stay joining while another child is still running',
    );

    await repository.cancelDelegation(scenarioScope, runId, childB.delegationId, 1, now + 3);
    resumeRows = await db.queryAll<{ id: string; status: string; version: number }>(
      `SELECT id, status, version FROM agent_scheduler_work WHERE run_id = ? AND kind = 'join_resume'`,
      [runId],
    );
    assert.equal(resumeRows.length, 1, 'multiple child completions must merge into one join_resume lineage');
    assert.equal(resumeRows[0]?.status, 'queued');
    const finalReady = (await repository.readyWork(now + 3, 16)).find((work) => work.kind === 'join_resume');
    assert.ok(finalReady);
    const finalClaim = await repository.claimWork(finalReady.id, finalReady.version, 333, now + 3);
    assert.ok(finalClaim);
    await participant.handleJoinResume(scenarioScope, finalClaim, 333);
    assert.equal(
      (await db.queryOne<{ schedule_state: string }>('SELECT schedule_state FROM agent_runtimes WHERE id = ?', [parentRuntimeId]))
        ?.schedule_state,
      'runnable',
    );
    const modelResume = await db.queryAll<{ id: string; status: string; payload_json: string }>(
      `SELECT id, status, payload_json FROM agent_scheduler_work
       WHERE run_id = ? AND agent_runtime_id = ? AND kind = 'model_step' AND id LIKE 'model-resume:%'`,
      [runId, parentRuntimeId],
    );
    assert.equal(modelResume.length, 1);
    assert.equal(modelResume[0]?.status, 'queued');
    assert.equal(JSON.parse(modelResume[0]!.payload_json).delegationId, 'join-parent-delegation');
    assert.equal(hostRootEnqueues.length, 0, 'nested parent must resume through durable child model work, not Root queue');

    await repository.cancelDelegation(scenarioScope, runId, childB.delegationId, 2, now + 4);
    assert.equal(
      (
        await db.queryAll<{ id: string }>(
          `SELECT id FROM agent_scheduler_work
           WHERE run_id = ? AND agent_runtime_id = ? AND kind = 'model_step' AND id LIKE 'model-resume:%'`,
          [runId, parentRuntimeId],
        )
      ).length,
      1,
      'repeated terminal notification must not duplicate the parent model resume work',
    );

    const receipt = await repository.sendMessage({
      scope: scenarioScope,
      id: 'join-normal-completion-message',
      runId,
      senderRuntimeId: childB.runtimeId,
      recipientRuntimeId: parentRuntimeId,
      delegationId: childB.delegationId,
      kind: 'completion',
      idempotencyKey: 'join-normal-completion-key',
      payloadHash: 'join-normal-completion-hash',
      correlationId: childB.delegationId,
      replyTo: null,
      causationId: null,
      taskRevision: 1,
      body: { outcome: 'cancelled' },
      artifactRefs: [],
      sizeBytes: 64,
      expiresAt: now + 600,
      now: now + 5,
      maxPending: 100,
      maxHardRunMessages: 1000,
      maxHardRunBytes: 1_048_576,
    });
    assert.equal(receipt.replayed, false);
    assert.equal(
      (await db.queryOne<{ kind: string }>('SELECT kind FROM agent_messages WHERE id = ?', [receipt.messageId]))?.kind,
      'completion',
    );

    // Root uses the same durable join_resume invariant; only the final handoff target differs.
    await db.execute(
      `UPDATE agent_runtimes SET schedule_state = 'joining', updated_at = ?
       WHERE id = 'join-root-runtime' AND run_id = ? AND status = 'running'`,
      [now + 6, runId],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('root-join-control-step', ?, 'join-root-runtime', 2, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
      [runId, now + 6, now + 6],
    );
    const rootJoinInspection = {
      ...joinInspection,
      normalizedArguments: {
        delegationIds: ['join-parent-delegation'],
        mode: 'all',
        deadlineAt: now + 500,
      },
      operationHash: 'root-join-control-hash',
    };
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
         created_at, started_at, completed_at)
       VALUES ('root-join-control-tool-call', ?, 'join-root-runtime', 'root-join-control-step',
               'provider-root-join-control', 'join_subagents', '1', ?, 'root-join-control-hash', 1,
               'control', 'succeeded', ?, ?, ?, ?)`,
      [runId, JSON.stringify(rootJoinInspection), JSON.stringify(waitingResult), now + 6, now + 6, now + 6],
    );
    await repository.cancelDelegation(scenarioScope, runId, 'join-parent-delegation', 1, now + 7);
    const rootResumeReady = (await repository.readyWork(now + 7, 32)).find(
      (work) => work.kind === 'join_resume' && work.agentRuntimeId === 'join-root-runtime',
    );
    assert.ok(rootResumeReady, 'terminal nested parent must create a durable Root join_resume work');
    const rootResumeClaim = await repository.claimWork(rootResumeReady.id, rootResumeReady.version, 444, now + 7);
    assert.ok(rootResumeClaim);
    await participant.handleJoinResume(scenarioScope, rootResumeClaim, 444);
    assert.equal(
      (await db.queryOne<{ schedule_state: string }>(
        "SELECT schedule_state FROM agent_runtimes WHERE id = 'join-root-runtime'",
      ))?.schedule_state,
      'runnable',
    );
    assert.deepEqual(hostRootEnqueues, [runId]);

    return [
      { name: 'durable_join_resume_rows', value: resumeRows.length, unit: 'work-items' },
      { name: 'nested_model_resume_rows', value: modelResume.length, unit: 'work-items' },
      { name: 'mailbox_independent_resumes', value: 1, unit: 'joins' },
      { name: 'root_durable_resumes', value: hostRootEnqueues.length, unit: 'runs' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const confirmedMutationLeaseFinalizationScenario: Scenario = async () => {
  const runFault = async (fault: 'mark_settled' | 'release'): Promise<void> => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `nexus-agent-lease-finalize-${fault}-`));
    const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'lease-finalize.sqlite', nodeEnv: 'test' });
    const leases = new SqliteLeaseRepository(db);
    const stateCommit = new SqliteStateCommitAdapter(db);
    const runs = new SqliteRunRepository(db);
    const now = fault === 'mark_settled' ? 1_800_600_000 : 1_800_610_000;
    const faultScope: Scope = { userId: 1, appId: `lease-finalize-${fault}` };
    const runId = `lease-finalize-run-${fault}`;
    const runtimeId = `lease-finalize-runtime-${fault}`;
    const toolCallId = `lease-finalize-tool-${fault}`;
    const resourceKey = `connection:42:path:/tmp/${fault}`;
    const modelRef = {
      providerId: 'scenario-provider',
      modelId: 'scenario-model',
      configurationVersion: 1,
    };
    const budget = {
      maxContextTokens: 16_384,
      maxOutputTokens: 4_096,
        maxRunSteps: 100,
      maxActiveExecutionSeconds: 3_600,
      toolTimeoutSeconds: 120,
      maxToolOutputBytes: 1_048_576,
      maxRawToolBytes: 1_048_576,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      maxSubagentMessages: 100,
      maxSubagentMessageBytes: 1_048_576,
      revision: 1,
    };
    const definition = {
      schemaVersion: 1,
      agentDefinitionId: 'scenario-agent',
      model: modelRef,
      approvalMode: 'ask',
      connectionIds: [42],
      policyRevision: 1,
      settingsRevision: 1,
    };
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 1,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    };
    let markFailures = fault === 'mark_settled' ? 1 : 0;
    let releaseFailures = fault === 'release' ? 1 : 0;
    const faultingLeases: LeasePort = {
      acquireMany: (owner, resourceKeys, mode, ttlSeconds) => leases.acquireMany(owner, resourceKeys, mode, ttlSeconds),
      acquireResources: (owner, resources, ttlSeconds) => leases.acquireResources(owner, resources, ttlSeconds),
      renew: (leaseIds, owner, ttlSeconds) => leases.renew(leaseIds, owner, ttlSeconds),
      markMutationActive: (leaseIds, owner, operationId) => leases.markMutationActive(leaseIds, owner, operationId),
      markMutationSettled: async (leaseIds, owner, operationId) => {
        if (markFailures > 0) {
          markFailures -= 1;
          throw new Error('INJECTED_MARK_SETTLED_FAILURE');
        }
        await leases.markMutationSettled(leaseIds, owner, operationId);
      },
      release: async (leaseIds, owner) => {
        if (releaseFailures > 0) {
          releaseFailures -= 1;
          throw new Error('INJECTED_RELEASE_FAILURE');
        }
        await leases.release(leaseIds, owner);
      },
      quarantine: (owner, resourceKeys, reason, evidence, operationId) =>
        leases.quarantine(owner, resourceKeys, reason, evidence, operationId),
    };
    const guard = new AgentMutationLeaseGuardAdapter(faultingLeases, {
      nowUnixSeconds: () => now,
    } as ClockPort);

    try {
      await db.initialize();
      await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'lease-finalize-user', 'not-used')");
      await db.execute(
        `INSERT INTO agent_apps
          (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
         VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
        [faultScope.appId, now, now],
      );
      await db.execute(
        `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
         VALUES (?, 1, ?, 'lease finalize', 'manual', ?, ?)`,
        [`thread-${fault}`, faultScope.appId, now, now],
      );
      await db.execute(
        `INSERT INTO agent_runs
          (id, user_id, app_id, thread_id, status, goal_status, verification_status,
           budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
           created_at, started_at, updated_at)
         VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', ?, ?,
                 '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
        [
          runId,
          faultScope.appId,
          `thread-${fault}`,
          JSON.stringify(budget),
          JSON.stringify(definition),
          JSON.stringify(usage),
          now,
          now,
          now,
        ],
      );
      await db.execute(
        `INSERT INTO agent_runtimes
          (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
           consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
         VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, ?, ?, ?)`,
        [runtimeId, runId, JSON.stringify(modelRef), `owner-${runtimeId}`, now, now],
      );
      await db.execute(
        `INSERT INTO agent_steps
          (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
           input_refs_json, output_refs_json, created_at, completed_at)
         VALUES (?, ?, ?, 1, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
        [`step-${fault}`, runId, runtimeId, now, now],
      );
      const confirmedResult = {
        ok: true,
        summary: 'Mutation completed exactly once.',
        data: { changed: true },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: { status: 'verified', summary: 'remote state confirmed', evidenceRefs: [] },
      };
      await db.execute(
        `INSERT INTO agent_tool_calls
          (id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
           inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
           created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, 'scenario_mutation', '1', '{}', ?, 1, 'mutate', 'succeeded', ?, ?, ?, ?)`,
        [
          toolCallId,
          runId,
          runtimeId,
          `step-${fault}`,
          `provider-${fault}`,
          `operation-hash-${fault}`,
          JSON.stringify(confirmedResult),
          now,
          now,
          now,
        ],
      );

      const handle = await guard.acquire({
        runtimeId,
        operationId: toolCallId,
        resourceKeys: [resourceKey],
        ttlSeconds: 120,
        signal: new AbortController().signal,
        deadlineAt: now + 60,
      });
      await handle.activate();
      const finalization = await handle.confirm();
      assert.equal(finalization.ok, false);
      if (finalization.ok) throw new Error('EXPECTED_LEASE_FINALIZATION_FAILURE');
      assert.equal(finalization.reason, 'LEASE_STATE_UNCERTAIN_AFTER_MUTATION');
      assert.deepEqual(finalization.resourceKeys, [resourceKey]);

      const attention = await stateCommit.commit({
        scope: faultScope,
        runId,
        expectedRunVersion: 1,
        events: [
          {
            type: 'run.reconciliation_required',
            payload: {
              kind: 'lease_finalization',
              mutationOutcome: 'confirmed',
              toolCallId,
              resourceKeys: finalization.resourceKeys,
              reason: finalization.reason,
              errorCode: finalization.errorCode,
            },
          },
        ],
        runPatch: { needsReconciliation: true },
        now: now + 1,
      });
      assert.equal(attention.run.needsReconciliation, true);
      assert.equal(attention.run.status, 'running');
      const tool = await db.queryOne<{ status: string; result_json: string }>(
        'SELECT status, result_json FROM agent_tool_calls WHERE id = ?',
        [toolCallId],
      );
      assert.equal(tool?.status, 'succeeded');
      assert.equal((JSON.parse(tool!.result_json) as { outcome: string }).outcome, 'confirmed');

      const reconciliation = await runs.reconciliation(faultScope, runId);
      assert.equal(reconciliation.required, true);
      assert.equal(reconciliation.resources.length, 1);
      assert.equal(reconciliation.resources[0]?.resourceKey, resourceKey);
      assert.equal(reconciliation.resources[0]?.reason, 'LEASE_STATE_UNCERTAIN_AFTER_MUTATION');
      await assert.rejects(
        () => leases.acquireMany({ type: 'agent', id: runtimeId }, [resourceKey], 'write', 60),
        /RESOURCE_QUARANTINED/,
      );

      const resolved = await stateCommit.resolveRunReconciliation({
        scope: faultScope,
        runId,
        expectedRunVersion: attention.run.version,
        note: 'Lease/resource state inspected after an already-confirmed mutation.',
        resources: reconciliation.resources.map((resource) => ({
          resourceKey: resource.resourceKey,
          version: resource.version,
        })),
        now: now + 2,
      });
      assert.equal(resolved.run.needsReconciliation, false);
      const after = await runs.reconciliation(faultScope, runId);
      assert.equal(after.required, false);
      assert.equal(after.resources.length, 0);
      const nextLease = await leases.acquireMany({ type: 'agent', id: runtimeId }, [resourceKey], 'write', 60);
      assert.equal(nextLease.length, 1);
      await leases.release(
        nextLease.map((lease) => lease.id),
        { type: 'agent', id: runtimeId },
      );
      assert.equal(
        (await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM agent_tool_calls WHERE run_id = ?', [runId]))
          ?.count,
        1,
        'lease reconciliation must never replay or duplicate the confirmed mutation tool call',
      );
    } finally {
      await db.close().catch(() => undefined);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  await runFault('mark_settled');
  await runFault('release');
  return [
    { name: 'finalization_fault_modes', value: 2, unit: 'modes' },
    { name: 'confirmed_mutations_replayed', value: 0, unit: 'tools' },
    { name: 'resources_unblocked_after_resolve', value: 2, unit: 'resources' },
  ];
};

const mutationOutputProjectionScenario: Scenario = async () => {
  const catalog = new ToolCatalog();
  const capabilities = {
    authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
  } as unknown as AppCapabilityBroker;
  const executor = new ToolExecutor(catalog, capabilities);
  const scope: Scope = { userId: 1, appId: 'tool-projection-app' };
  const context: ToolContext = {
    ...scope,
    actor: {
      kind: 'agent',
      userId: 1,
      appId: scope.appId,
      runId: 'tool-projection-run',
      agentRuntimeId: 'tool-projection-runtime',
    },
    runId: 'tool-projection-run',
    agentRuntimeId: 'tool-projection-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'tool-projection-step',
    signal: new AbortController().signal,
    deadlineAt: 1_800_700_100,
    maxOutputBytes: 2_048,
    inputRevision: 0,
  };
  const executionCounts = new Map<string, number>();
  const inspectionFor = (toolName: string): ToolInspection => ({
    toolName,
    toolVersion: '1',
    normalizedArguments: {},
    target: {
      kind: 'run',
      targetIdentity: `run:${context.runId}:${toolName}`,
      endpoint: `run:${context.runId}`,
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash: `projection-${toolName}`,
    },
    resourceKeys: [`projection:${toolName}`],
    risk: 'mutate',
    mutation: true,
    operationHash: `projection-${toolName}`,
    operationHashVersion: 1,
    preconditions: [],
    secretRefs: [],
    policyRevision: 1,
    inputRevision: 0,
  });
  const largeTool = (toolName: string, transport: string): AgentTool => ({
    descriptor: {
      name: toolName,
      version: '1',
      description: `${transport} mutation with a deliberately large protocol-complete response`,
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass: 'mutate',
      capability: 'runs.execute',
    },
    inspect: async () => inspectionFor(toolName),
    execute: async () => {
      executionCounts.set(toolName, (executionCounts.get(toolName) ?? 0) + 1);
      return {
        ok: true,
        summary: `${transport} mutation completed. ${'summary '.repeat(2_000)}`,
        data: {
          transport,
          ready: true,
          content: 'x'.repeat(160_000),
          structuredContent: {
            status: 'ok',
            rows: Array.from({ length: 256 }, (_, index) => ({ index, value: 'y'.repeat(512) })),
          },
        },
        artifactRefs: [`artifact-${transport}`],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary: `The ${transport} endpoint returned a protocol-complete success response. ${'verified '.repeat(500)}`,
          evidenceRefs: [`evidence-${transport}`],
        },
      };
    },
  });
  const interruptedToolName = 'scenario_transport_interruption';
  const interruptedTool: AgentTool = {
    descriptor: {
      name: interruptedToolName,
      version: '1',
      description: 'Mutation whose transport fails before a complete response is available',
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass: 'mutate',
      capability: 'runs.execute',
    },
    inspect: async () => inspectionFor(interruptedToolName),
    execute: async () => {
      executionCounts.set(interruptedToolName, (executionCounts.get(interruptedToolName) ?? 0) + 1);
      throw new Error('ECONNRESET');
    },
  };
  const transportTools = [
    largeTool('scenario_mcp_mutation', 'mcp'),
    largeTool('scenario_acp_mutation', 'acp'),
    largeTool('scenario_workspace_mutation', 'workspace'),
  ];
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.output-projection',
    capability: 'runs.execute',
    tools: [...transportTools, interruptedTool],
  });

  for (const tool of transportTools) {
    const result = await executor.executeMutation(context, inspectionFor(tool.descriptor.name));
    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.ok, true);
    assert.equal(result.verification.status, 'verified');
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= context.maxOutputBytes);
    assert.equal(executionCounts.get(tool.descriptor.name), 1, `${tool.descriptor.name} must execute exactly once`);
    assert.ok(result.data && typeof result.data === 'object' && !Array.isArray(result.data));
    assert.equal((result.data as Record<string, unknown>).ready, true, 'small control scalars must survive projection');
  }

  const noopLease: MutationLeaseGuardHandle = {
    signal: context.signal,
    stopRenewal: async () => null,
    activate: async () => undefined,
    quarantine: async () => undefined,
    confirm: async () => ({ ok: true }),
    releaseIfInactive: async () => undefined,
  };
  const runner = new ToolCallRunner(catalog, executor, null!, null!, null!);
  const interrupted = await runner.executeMutation(noopLease, context, inspectionFor(interruptedToolName));
  assert.equal(interrupted.outcome, 'unknown');
  assert.equal(interrupted.errorCode, 'ECONNRESET');
  assert.equal(executionCounts.get(interruptedToolName), 1);

  return [
    { name: 'large_confirmed_mutations', value: transportTools.length, unit: 'tools' },
    { name: 'mutation_replays', value: 0, unit: 'tools' },
    { name: 'transport_interruptions_unknown', value: interrupted.outcome === 'unknown' ? 1 : 0, unit: 'tools' },
  ];
};

const artifactCrashReconciliationScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-reconcile-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'artifact-reconcile.sqlite', nodeEnv: 'test' });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 1024 * 1024,
      maxGlobalArtifactBytes: 8 * 1024 * 1024,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const now = Math.floor(Date.now() / 1000);
  const appId = 'artifact-reconcile-app';
  const objectRoot = path.join(directory, 'agent', 'artifacts', 'objects');
  const tmpRoot = path.join(directory, 'agent', 'artifacts', 'tmp');
  const quotaScope = 'artifact:user:1';
  const payload = Buffer.from('artifact-crash-window-payload'.repeat(8), 'utf8');
  const payloadHash = createHash('sha256').update(payload).digest('hex');

  const insertArtifact = async (input: {
    id: string;
    storageKey: string;
    status: 'staging' | 'deleting';
    reservedBytes: number;
    sizeBytes: number;
    expiresAt: number | null;
    sha256?: string | null;
  }): Promise<void> => {
    await db.execute(
      `INSERT INTO ai_artifacts
        (id, user_id, app_id, original_name, media_type, storage_key, sha256,
         size_bytes, reserved_bytes, status, retained, version, created_at, ready_at, expires_at, deleted_at)
       VALUES (?, 1, ?, ?, 'application/octet-stream', ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, NULL)`,
      [
        input.id,
        appId,
        `${input.id}.bin`,
        input.storageKey,
        input.sha256 ?? null,
        input.sizeBytes,
        input.reservedBytes,
        input.status,
        now - 30,
        input.status === 'deleting' ? now - 20 : null,
        input.expiresAt,
      ],
    );
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-reconcile-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', ?, ?)`,
      [appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_quota_usage (scope_key, limit_bytes, used_bytes, reserved_bytes)
       VALUES (?, ?, 0, 0)`,
      [quotaScope, 8 * 1024 * 1024],
    );
    fs.mkdirSync(objectRoot, { recursive: true });
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Crash window 1: rename(tmp -> object) completed, ready DB transaction never committed.
    const renamedKey = 'aa-renamed-before-ready';
    await insertArtifact({
      id: 'artifact-renamed-before-ready',
      storageKey: renamedKey,
      status: 'staging',
      reservedBytes: payload.length,
      sizeBytes: 0,
      expiresAt: now + 60,
    });
    await db.execute('UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.mkdirSync(path.join(objectRoot, renamedKey.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(objectRoot, renamedKey.slice(0, 2), renamedKey), payload);

    // Abandoned staging before rename: expiry must release reservation and delete the partial tmp file.
    const expiredKey = 'bb-expired-staging';
    await insertArtifact({
      id: 'artifact-expired-staging',
      storageKey: expiredKey,
      status: 'staging',
      reservedBytes: payload.length,
      sizeBytes: 0,
      expiresAt: now - 1,
    });
    await db.execute('UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.writeFileSync(path.join(tmpRoot, `${expiredKey}.part`), payload.subarray(0, 16));

    // Crash window 2: deleting was durable, object removal never happened.
    const deletingFileKey = 'cc-deleting-file-present';
    await insertArtifact({
      id: 'artifact-deleting-file-present',
      storageKey: deletingFileKey,
      status: 'deleting',
      reservedBytes: 0,
      sizeBytes: payload.length,
      expiresAt: null,
      sha256: payloadHash,
    });
    await db.execute('UPDATE agent_quota_usage SET used_bytes = used_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.mkdirSync(path.join(objectRoot, deletingFileKey.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(objectRoot, deletingFileKey.slice(0, 2), deletingFileKey), payload);

    // Crash window 3: object removal completed, deleted DB/quota transaction never committed.
    const deletingGoneKey = 'dd-deleting-file-gone';
    await insertArtifact({
      id: 'artifact-deleting-file-gone',
      storageKey: deletingGoneKey,
      status: 'deleting',
      reservedBytes: 0,
      sizeBytes: payload.length,
      expiresAt: null,
      sha256: payloadHash,
    });
    await db.execute('UPDATE agent_quota_usage SET used_bytes = used_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);

    const repaired = await store.reconcile(32);
    assert.equal(repaired, 4);

    const renamed = await db.queryOne<{
      status: string;
      sha256: string | null;
      size_bytes: number;
      reserved_bytes: number;
    }>('SELECT status, sha256, size_bytes, reserved_bytes FROM ai_artifacts WHERE id = ?', [
      'artifact-renamed-before-ready',
    ]);
    assert.deepEqual(renamed, {
      status: 'ready',
      sha256: payloadHash,
      size_bytes: payload.length,
      reserved_bytes: 0,
    });
    assert.equal(
      (await db.queryOne<{ status: string }>('SELECT status FROM ai_artifacts WHERE id = ?', ['artifact-expired-staging']))
        ?.status,
      'deleted',
    );
    assert.equal(fs.existsSync(path.join(tmpRoot, `${expiredKey}.part`)), false);
    for (const [id, storageKey] of [
      ['artifact-deleting-file-present', deletingFileKey],
      ['artifact-deleting-file-gone', deletingGoneKey],
    ] as const) {
      assert.equal((await db.queryOne<{ status: string }>('SELECT status FROM ai_artifacts WHERE id = ?', [id]))?.status, 'deleted');
      assert.equal(fs.existsSync(path.join(objectRoot, storageKey.slice(0, 2), storageKey)), false);
    }
    const quota = await db.queryOne<{ used_bytes: number; reserved_bytes: number }>(
      'SELECT used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
      [quotaScope],
    );
    assert.deepEqual(quota, { used_bytes: payload.length, reserved_bytes: 0 });

    // A second pass must be a pure no-op: no duplicate quota transfer or decrement.
    assert.equal(await store.reconcile(32), 0);
    assert.deepEqual(
      await db.queryOne<{ used_bytes: number; reserved_bytes: number }>(
        'SELECT used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
        [quotaScope],
      ),
      quota,
    );

    return [
      { name: 'artifact_crash_windows_repaired', value: 3, unit: 'windows' },
      { name: 'expired_staging_repaired', value: 1, unit: 'artifacts' },
      { name: 'idempotent_second_pass_repairs', value: 0, unit: 'artifacts' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const integrationCasBeforeRuntimeScenario: Scenario = async () => {
  const scope: Scope = { userId: 1, appId: 'integration-cas-app' };
  const integrationId = '00000000-0000-4000-8000-000000000105';
  const configuration = (displayName: string, endpoint: string) => ({
    displayName,
    transport: 'streamable-http' as const,
    endpoint,
    privateHostExceptions: [] as string[],
    protocolVersion: '2026-07-28' as const,
  });
  let current: IntegrationView | null = {
    ...scope,
    id: integrationId,
    kind: 'mcp',
    configuration: configuration('v2', 'https://example.com/v2'),
    hasCredential: false,
    credentialRevision: 1,
    schemaHash: 'schema-v2',
    enabled: true,
    version: 2,
    createdAt: 1_800_800_000,
    updatedAt: 1_800_800_000,
  };
  const clone = (): IntegrationView | null => (current ? structuredClone(current) : null);
  const repository: IntegrationRepositoryPort = {
    get: async () => clone(),
    list: async (_scope, kind) => {
      const value = clone();
      return value && (!kind || value.kind === kind) ? [value] : [];
    },
    create: async () => {
      throw new Error('UNEXPECTED_CREATE');
    },
    update: async (_scope, _id, expectedVersion, record) => {
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('INTEGRATION_VERSION_CONFLICT');
      current = {
        ...current,
        configuration: record.configuration,
        enabled: record.enabled,
        schemaHash: null,
        credentialRevision:
          record.credential !== undefined || record.clearCredential ? current.credentialRevision + 1 : current.credentialRevision,
        hasCredential: record.credential !== undefined ? true : record.clearCredential ? false : current.hasCredential,
        version: current.version + 1,
        updatedAt: record.updatedAt,
      };
      return clone()!;
    },
    updateSchemaHash: async (_scope, _id, expectedVersion, expectedCredentialRevision, schemaHash, updatedAt) => {
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion || current.credentialRevision !== expectedCredentialRevision) return null;
      current = { ...current, schemaHash, updatedAt };
      return clone();
    },
    remove: async (_scope, _id, expectedVersion) => {
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('INTEGRATION_VERSION_CONFLICT');
      current = null;
    },
  };
  let failRefresh = false;
  const closeCalls: string[] = [];
  const refreshCalls: number[] = [];
  const mcp: McpRuntimePort = {
    close: async (id) => {
      closeCalls.push(id);
    },
    closeAll: async () => undefined,
    invoke: async () => ({ isError: false, content: null, structuredContent: null }),
    refresh: async (integration) => {
      refreshCalls.push(integration.version);
      if (failRefresh) throw new Error('INJECTED_REFRESH_FAILURE');
      return {
        serverName: 'scenario-mcp',
        serverVersion: '1',
        protocolVersion: '2026-07-28',
        tools: [],
      };
    },
  };
  const contributions = new Set<string>([integrationId]);
  const removedCalls: string[] = [];
  const refreshedCalls: number[] = [];
  const hooks: IntegrationServiceHooks = {
    removed: (_scope, id) => {
      removedCalls.push(id);
      contributions.delete(id);
    },
    mcpRefreshed: (_scope, integration) => {
      refreshedCalls.push(integration.version);
      contributions.add(integration.id);
    },
  };
  const service = new IntegrationService(
    repository,
    {
      resolve: async (url) => {
        const parsed = new URL(url);
        return {
          url,
          protocol: parsed.protocol as 'http:' | 'https:',
          hostname: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
          authority: parsed.host,
          addresses: ['203.0.113.10'],
          tlsServerName: parsed.hostname,
        };
      },
    },
    mcp,
    null!,
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    { nowUnixSeconds: () => 1_800_800_100 } as ClockPort,
    hooks,
  );
  const updateInput = (displayName: string, endpoint: string, enabled: boolean) => ({
    kind: 'mcp',
    configuration: configuration(displayName, endpoint),
    enabled,
  });

  await assert.rejects(
    () => service.update(scope, integrationId, 1, updateInput('stale', 'https://example.com/stale', false)),
    /INTEGRATION_VERSION_CONFLICT/,
  );
  assert.equal(current?.version, 2);
  assert.equal(closeCalls.length, 0, 'stale update must not close the live MCP session');
  assert.equal(removedCalls.length, 0, 'stale update must not remove the Tool contribution');
  assert.equal(contributions.has(integrationId), true);

  await assert.rejects(() => service.remove(scope, integrationId, 1), /INTEGRATION_VERSION_CONFLICT/);
  assert.equal(current?.version, 2);
  assert.equal(closeCalls.length, 0, 'stale remove must not close the live MCP session');
  assert.equal(removedCalls.length, 0, 'stale remove must not remove the Tool contribution');
  assert.equal(contributions.has(integrationId), true);

  const disabled = await service.update(
    scope,
    integrationId,
    2,
    updateInput('disabled-v3', 'https://example.com/v3', false),
  );
  assert.equal(disabled.version, 3);
  assert.equal(disabled.enabled, false);
  assert.deepEqual(closeCalls, [integrationId]);
  assert.deepEqual(removedCalls, [integrationId]);
  assert.equal(contributions.has(integrationId), false);

  failRefresh = true;
  const enabled = await service.update(
    scope,
    integrationId,
    3,
    updateInput('enabled-v4', 'https://example.com/v4', true),
  );
  assert.equal(enabled.version, 4);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(current?.version, 4);
  assert.equal(current?.schemaHash, null, 'failed runtime reconcile must leave durable refresh-needed state');
  assert.equal(contributions.has(integrationId), false, 'failed refresh must not publish a stale Tool contribution');
  assert.equal(refreshedCalls.length, 0);
  assert.ok(refreshCalls.includes(4));

  failRefresh = false;
  await service.syncEnabled(scope);
  assert.equal(current?.schemaHash === null, false, 'syncEnabled must be able to retry the failed refresh');
  assert.equal(contributions.has(integrationId), true);
  assert.ok(refreshedCalls.includes(4));

  const versionBeforeRemove = current!.version;
  await service.remove(scope, integrationId, versionBeforeRemove);
  assert.equal(current, null);
  assert.equal(contributions.has(integrationId), false);

  return [
    { name: 'stale_cas_runtime_side_effects', value: 0, unit: 'effects' },
    { name: 'successful_runtime_switches', value: 3, unit: 'transitions' },
    { name: 'refresh_failures_retried', value: 1, unit: 'integrations' },
  ];
};

const integrationRefreshGenerationScenario: Scenario = async () => {
  const scope: Scope = { userId: 1, appId: 'integration-refresh-app' };
  const integrationId = '00000000-0000-4000-8000-000000000106';
  const configuration = (generation: number) => ({
    displayName: `generation-${generation}`,
    transport: 'streamable-http' as const,
    endpoint: `https://example.com/g${generation}`,
    privateHostExceptions: [] as string[],
    protocolVersion: '2026-07-28' as const,
  });
  let current: IntegrationView | null = {
    ...scope,
    id: integrationId,
    kind: 'mcp',
    configuration: configuration(1),
    hasCredential: false,
    credentialRevision: 1,
    schemaHash: null,
    enabled: true,
    version: 1,
    createdAt: 1_800_900_000,
    updatedAt: 1_800_900_000,
  };
  const clone = (): IntegrationView | null => (current ? structuredClone(current) : null);
  const repository: IntegrationRepositoryPort = {
    get: async () => clone(),
    list: async (_scope, kind) => {
      const value = clone();
      return value && (!kind || value.kind === kind) ? [value] : [];
    },
    create: async () => {
      throw new Error('UNEXPECTED_CREATE');
    },
    update: async (_scope, _id, expectedVersion, record) => {
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('INTEGRATION_VERSION_CONFLICT');
      current = {
        ...current,
        configuration: record.configuration,
        enabled: record.enabled,
        schemaHash: null,
        credentialRevision:
          record.credential !== undefined || record.clearCredential ? current.credentialRevision + 1 : current.credentialRevision,
        hasCredential: record.credential !== undefined ? true : record.clearCredential ? false : current.hasCredential,
        version: current.version + 1,
        updatedAt: record.updatedAt,
      };
      return clone()!;
    },
    updateSchemaHash: async (_scope, _id, expectedVersion, expectedCredentialRevision, schemaHash, updatedAt) => {
      if (!current) return null;
      if (current.version !== expectedVersion || current.credentialRevision !== expectedCredentialRevision) return null;
      current = { ...current, schemaHash, updatedAt };
      return clone();
    },
    remove: async () => {
      throw new Error('UNEXPECTED_REMOVE');
    },
  };

  let releaseGeneration1!: () => void;
  const generation1Barrier = new Promise<void>((resolve) => {
    releaseGeneration1 = resolve;
  });
  let generation1Started!: () => void;
  const generation1StartedPromise = new Promise<void>((resolve) => {
    generation1Started = resolve;
  });
  let releaseGeneration2!: () => void;
  let blockGeneration2 = false;
  const generation2Barrier = new Promise<void>((resolve) => {
    releaseGeneration2 = resolve;
  });
  let generation2Started!: () => void;
  const generation2StartedPromise = new Promise<void>((resolve) => {
    generation2Started = resolve;
  });
  const closeCalls: number[] = [];
  const mcp: McpRuntimePort = {
    close: async () => {
      closeCalls.push(current?.version ?? -1);
    },
    closeAll: async () => undefined,
    invoke: async () => ({ isError: false, content: null, structuredContent: null }),
    refresh: async (integration) => {
      if (integration.version === 1) {
        generation1Started();
        await generation1Barrier;
      }
      if (integration.version === 2 && blockGeneration2) {
        generation2Started();
        await generation2Barrier;
      }
      return {
        serverName: `server-v${integration.version}`,
        serverVersion: `${integration.version}`,
        protocolVersion: '2026-07-28',
        tools: [
          {
            remoteName: `tool_v${integration.version}_c${integration.credentialRevision}`,
            title: null,
            description: `tool for generation ${integration.version}`,
            inputSchema: { type: 'object' },
            outputSchema: null,
            annotations: null,
          },
        ],
      };
    },
  };
  const publishedTools: string[] = [];
  let publishedGeneration = 0;
  let generation2Published!: () => void;
  let generation3Published!: () => void;
  const generation2PublishedPromise = new Promise<void>((resolve) => {
    generation2Published = resolve;
  });
  const generation3PublishedPromise = new Promise<void>((resolve) => {
    generation3Published = resolve;
  });
  const hooks: IntegrationServiceHooks = {
    removed: () => {
      publishedTools.length = 0;
    },
    mcpRefreshed: (_scope, integration, snapshot) => {
      publishedGeneration = integration.version;
      publishedTools.splice(0, publishedTools.length, ...snapshot.tools.map((tool) => tool.remoteName));
      if (integration.version === 2) generation2Published();
      if (integration.version === 3) generation3Published();
    },
  };
  const service = new IntegrationService(
    repository,
    {
      resolve: async (url) => {
        const parsed = new URL(url);
        return {
          url,
          protocol: parsed.protocol as 'http:' | 'https:',
          hostname: parsed.hostname,
          port: 443,
          authority: parsed.host,
          addresses: ['203.0.113.11'],
          tlsServerName: parsed.hostname,
        };
      },
    },
    mcp,
    null!,
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    { nowUnixSeconds: () => 1_800_900_100 } as ClockPort,
    hooks,
  );
  const updateInput = (generation: number, credential?: string) => ({
    kind: 'mcp',
    configuration: configuration(generation),
    enabled: true,
    ...(credential === undefined ? {} : { credential }),
  });

  const staleV1 = service.refresh(scope, integrationId);
  await generation1StartedPromise;
  const v2 = await service.update(scope, integrationId, 1, updateInput(2));
  assert.equal(v2.version, 2);
  assert.equal(v2.schemaHash, null);
  releaseGeneration1();
  await assert.rejects(staleV1, /INTEGRATION_REFRESH_STALE/);
  await generation2PublishedPromise;
  assert.equal(current?.version, 2);
  assert.notEqual(current?.schemaHash, null);
  assert.equal(publishedGeneration, 2);
  assert.deepEqual(publishedTools, ['tool_v2_c1']);
  assert.equal(publishedTools.includes('tool_v1_c1'), false, 'stale v1 descriptor must never reach ToolCatalog');

  blockGeneration2 = true;
  const staleV2 = service.refresh(scope, integrationId);
  await generation2StartedPromise;
  const v3 = await service.update(scope, integrationId, 2, updateInput(2, 'credential-v2'));
  assert.equal(v3.version, 3);
  assert.equal(v3.credentialRevision, 2);
  assert.equal(v3.schemaHash, null);
  releaseGeneration2();
  await assert.rejects(staleV2, /INTEGRATION_REFRESH_STALE/);
  await generation3PublishedPromise;
  assert.equal(current?.version, 3);
  assert.equal(current?.credentialRevision, 2);
  assert.notEqual(current?.schemaHash, null);
  assert.equal(publishedGeneration, 3);
  assert.deepEqual(publishedTools, ['tool_v3_c2']);
  assert.equal(publishedTools.includes('tool_v2_c1'), false, 'credential-stale descriptor must never be republished');

  return [
    { name: 'stale_refreshes_published', value: 0, unit: 'refreshes' },
    { name: 'generation_safe_refreshes', value: 2, unit: 'refreshes' },
    { name: 'credential_generation_races', value: 1, unit: 'races' },
    { name: 'stale_sessions_closed', value: closeCalls.length > 0 ? 1 : 0, unit: 'checks' },
  ];
};

const idempotencyTtlScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-idempotency-ttl-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'idempotency-ttl.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_000_000;
  const scope: Scope = { userId: 1, appId: 'idempotency-ttl-app' };
  const runId = 'idempotency-ttl-run';
  const threadId = 'idempotency-ttl-thread';
  const modelRef = {
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  };
  const budget = {
    maxContextTokens: 16_384,
    maxOutputTokens: 4_096,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  };
  const definition = {
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: modelRef,
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  };
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  };
  const insertCommand = async (
    id: string,
    key: string,
    status: 'pending' | 'committed' | 'unknown',
    expiresAt: number,
  ): Promise<void> => {
    await db.execute(
      `INSERT INTO agent_commands
        (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
         response_json, result_entity_id, generation, created_at, completed_at, expires_at)
       VALUES (?, 1, ?, 'scenario.cleanup', ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
      [
        id,
        scope.appId,
        key,
        `hash-${key}`,
        status,
        status === 'committed' ? 200 : null,
        status === 'committed' ? '{}' : null,
        now - 100,
        status === 'committed' ? now - 50 : null,
        expiresAt,
      ],
    );
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'idempotency-ttl-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'idempotency ttl', 'manual', ?, ?)`,
      [threadId, scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', ?, ?,
               '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scope.appId, threadId, JSON.stringify(budget), JSON.stringify(definition), JSON.stringify(usage), now, now, now],
    );

    const first = await stateCommit.setRunGoal({
      scope,
      runId,
      text: 'first goal',
      expectedRunVersion: 1,
      idempotencyKey: 'goal-key',
      requestHash: 'goal-hash-a',
      now,
    });
    assert.equal(first.replayed, false);
    assert.equal(first.run.goal.text, 'first goal');

    const replay = await stateCommit.setRunGoal({
      scope,
      runId,
      text: 'first goal',
      expectedRunVersion: first.run.version,
      idempotencyKey: 'goal-key',
      requestHash: 'goal-hash-a',
      now: now + 60,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.version, first.run.version);

    await assert.rejects(
      () =>
        stateCommit.setRunGoal({
          scope,
          runId,
          text: 'different before ttl',
          expectedRunVersion: first.run.version,
          idempotencyKey: 'goal-key',
          requestHash: 'goal-hash-b',
          now: now + 120,
        }),
      /IDEMPOTENCY_PAYLOAD_MISMATCH/,
    );

    const goalCommand = await db.queryOne<{ expires_at: number }>(
      `SELECT expires_at FROM agent_commands
       WHERE user_id = 1 AND app_id = ? AND command_name = 'run.goal.set' AND idempotency_key = 'goal-key'`,
      [scope.appId],
    );
    assert.equal(goalCommand?.expires_at, now + 24 * 60 * 60);
    const afterTtl = await stateCommit.setRunGoal({
      scope,
      runId,
      text: 'second goal after ttl',
      expectedRunVersion: first.run.version,
      idempotencyKey: 'goal-key',
      requestHash: 'goal-hash-b',
      now: now + 24 * 60 * 60,
    });
    assert.equal(afterTtl.replayed, false);
    assert.equal(afterTtl.run.goal.text, 'second goal after ttl');
    assert.equal(afterTtl.run.version, first.run.version + 1);
    assert.deepEqual(
      await db.queryOne<{ count: number; request_hash: string }>(
        `SELECT COUNT(*) AS count, MAX(request_hash) AS request_hash FROM agent_commands
         WHERE user_id = 1 AND app_id = ? AND command_name = 'run.goal.set' AND idempotency_key = 'goal-key'`,
        [scope.appId],
      ),
      { count: 1, request_hash: 'goal-hash-b' },
    );

    await insertCommand('cleanup-committed-1', 'cleanup-committed-1', 'committed', now - 10);
    await insertCommand('cleanup-committed-2', 'cleanup-committed-2', 'committed', now - 9);
    await insertCommand('cleanup-committed-3', 'cleanup-committed-3', 'committed', now - 8);
    await insertCommand('cleanup-pending', 'cleanup-pending', 'pending', now - 1000);
    await insertCommand('cleanup-unknown', 'cleanup-unknown', 'unknown', now - 1000);
    await insertCommand('cleanup-future', 'cleanup-future', 'committed', now + 1000);

    assert.equal(await stateCommit.cleanupExpiredCommands(now, 2), 2);
    assert.equal(
      (await db.queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM agent_commands
         WHERE command_name = 'scenario.cleanup' AND status = 'committed' AND expires_at <= ?`,
        [now],
      ))?.count,
      1,
      'bounded cleanup must leave work for the next sweep',
    );
    assert.equal(await stateCommit.cleanupExpiredCommands(now, 200), 1);
    const retainedEvidence = await db.queryAll<{ id: string; status: string }>(
      `SELECT id, status FROM agent_commands
       WHERE id IN ('cleanup-pending','cleanup-unknown') ORDER BY id`,
    );
    assert.deepEqual(retainedEvidence, [
      { id: 'cleanup-pending', status: 'pending' },
      { id: 'cleanup-unknown', status: 'unknown' },
    ]);
    assert.equal(
      (await db.queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM agent_commands WHERE id = 'cleanup-future'"))?.count,
      1,
    );

    return [
      { name: 'ttl_window_replays', value: 1, unit: 'commands' },
      { name: 'ttl_expired_key_reuses', value: 1, unit: 'commands' },
      { name: 'bounded_cleanup_passes', value: 2, unit: 'passes' },
      { name: 'nonterminal_evidence_retained', value: retainedEvidence.length, unit: 'commands' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const cumulativeTokenCeilingRemovedScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-token-ceiling-removed-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'token-ceiling.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_100_000;
  const scenarioScope: Scope = { userId: 1, appId: 'token-ceiling-app' };
  const runId = 'token-ceiling-run';
  const rootRuntimeId = 'token-ceiling-root';
  const childRuntimeId = 'token-ceiling-child';
  const delegationId = 'token-ceiling-delegation';
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const budget = JSON.stringify({
    maxContextTokens: 200_000,
    maxOutputTokens: 8_192,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: JSON.parse(modelRef),
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 1_250_000,
    outputTokens: 350_000,
    cachedInputTokens: 700_000,
    steps: 4,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'token-ceiling-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('token-ceiling-thread', 1, ?, 'token ceiling removed', 'manual', ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'token-ceiling-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scenarioScope.appId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-token-root', ?, ?)`,
      [rootRuntimeId, runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'child:token-ceiling-delegation', 'native', ?, 'running', 'runnable', 0,
               'owner-token-child', ?, ?)`,
      [childRuntimeId, runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, capabilities_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', '[]', 'parent-child', ?, 'continue despite cumulative token telemetry',
               '[]', '[]', '[]', 'settled', 'running', 1, 'isolate', 10,
               'token-ceiling-delegation-key', 'token-ceiling-delegation-hash', ?, 1, ?, ?)`,
      [delegationId, runId, rootRuntimeId, childRuntimeId, modelRef, now + 600, now, now],
    );
    await db.execute(
      `INSERT INTO agent_scheduler_work
        (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before, deadline_at,
         created_at, updated_at)
       VALUES ('token-ceiling-child-work', ?, ?, 'model_step', 'claimed', '{}', 77, ?, ?, ?, ?)`,
      [runId, childRuntimeId, now, now + 600, now, now],
    );

    const rootStarted = await stateCommit.beginModelStep({
      scope: scenarioScope,
      runId,
      runtimeId: rootRuntimeId,
      expectedRunVersion: 1,
      inputWatermark: 0,
      reservedTokens: 12_000,
      estimatedInputTokens: 74_000,
      reservedOutputTokens: 8_000,
      contextWindowTokens: 200_000,
      now: now + 1,
    });
    assert.equal(rootStarted.run.status, 'running');
    assert.equal(rootStarted.run.usage.inputTokens, 1_250_000);
    assert.equal(rootStarted.run.usage.outputTokens, 350_000);
    assert.deepEqual(rootStarted.run.usage.context, {
      inputTokens: 74_000,
      reservedOutputTokens: 8_000,
      contextWindowTokens: 200_000,
      source: 'estimated',
      updatedAt: now + 1,
    });

    const childStarted = await stateCommit.beginSubagentModelStep({
      scope: scenarioScope,
      runId,
      runtimeId: childRuntimeId,
      delegationId,
      workId: 'token-ceiling-child-work',
      ownerEpoch: 77,
      reservedTokens: 8_000,
      now: now + 2,
    });
    assert.equal(childStarted.run.status, 'running');
    assert.equal(childStarted.run.usage.inputTokens, 1_250_000);
    assert.equal(childStarted.run.usage.outputTokens, 350_000);

    const delegationColumns = await db.queryAll<{ name: string }>('PRAGMA table_info(agent_delegations)');
    const delegationColumnNames = new Set(delegationColumns.map((column) => column.name));
    for (const removed of ['max_tokens', 'reserved_tokens', 'reserved_steps']) {
      assert.equal(delegationColumnNames.has(removed), false, `${removed} must be removed from the current schema`);
    }

    assert.throws(
      () =>
        parseBudgetIncreaseRequest({
          schemaVersion: 1,
          scope: 'run',
          increase: { maxRunTokens: 2_000_000 },
          expectedVersion: childStarted.run.version,
        }),
      /VALIDATION_FAILED/,
    );

    return [
      { name: 'cumulative_tokens_before_next_step', value: 1_600_000, unit: 'tokens' },
      { name: 'root_steps_started_above_old_ceiling', value: 1, unit: 'steps' },
      { name: 'child_steps_started_above_old_ceiling', value: 1, unit: 'steps' },
      { name: 'removed_delegation_budget_columns', value: 3, unit: 'columns' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const progressAwareLoopGuardScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-loop-guard-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'loop-guard.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_200_000;
  const scenarioScope: Scope = { userId: 1, appId: 'loop-guard-app' };
  const runId = 'loop-guard-run';
  const runtimeId = 'loop-guard-root';
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const budget = JSON.stringify({
    maxContextTokens: 200_000,
    maxOutputTokens: 8_192,
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRawToolBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    model: JSON.parse(modelRef),
    approvalMode: 'ask',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const repeatedFailure = {
    ok: false,
    summary: 'The requested file does not exist.',
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed' as const,
    errorCode: 'ENOENT',
    verification: {
      status: 'failed' as const,
      summary: 'No file was read.',
      evidenceRefs: [],
    },
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'loop-guard-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('loop-guard-thread', 1, ?, 'loop guard', 'manual', ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'loop-guard-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scenarioScope.appId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'loop-owner', ?, ?)`,
      [runtimeId, runId, modelRef, now, now],
    );

    let version = 1;
    let warningTransitions = 0;
    let pausedStatus = '';
    for (let index = 1; index <= 4; index += 1) {
      const guarded = await stateCommit.evaluateToolLoopGuard({
        scope: scenarioScope,
        runId,
        runtimeId,
        expectedRunVersion: version,
        observations: [
          {
            toolName: 'workspace_read_file',
            risk: 'read',
            operationHash: 'repeat-missing-file-operation',
            result: repeatedFailure,
          },
        ],
        now: now + index,
      });
      warningTransitions += guarded.committedEvents.filter((event) => event.type === 'run.loop_warning').length;
      version = guarded.run.version;
      pausedStatus = guarded.run.status;
    }
    assert.equal(warningTransitions, 2, 'repeated failure must warn before pausing');
    assert.equal(pausedStatus, 'awaiting_input');
    assert.deepEqual(
      await db.queryOne<{ schedule_state: string }>(
        'SELECT schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
        [runtimeId, runId],
      ),
      { schedule_state: 'waiting_message' },
    );
    const pausedGuard = await db.queryOne<{
      epoch: number;
      no_progress_count: number;
      warning_level: number;
      last_reason: string | null;
    }>('SELECT epoch, no_progress_count, warning_level, last_reason FROM agent_loop_guards WHERE run_id = ?', [runId]);
    assert.deepEqual(pausedGuard, {
      epoch: 1,
      no_progress_count: 4,
      warning_level: 2,
      last_reason: 'exact_failure_replay',
    });

    const resumed = await stateCommit.appendInput({
      scope: scenarioScope,
      runId,
      inputEntryId: 'loop-guard-resume-input',
      input: { text: 'Use a different path and continue.', artifactRefs: [] },
      mode: 'append',
      expectedRunVersion: version,
      idempotencyKey: 'loop-guard-resume-key',
      requestHash: 'loop-guard-resume-hash',
      now: now + 10,
    });
    assert.equal(resumed.run.status, 'running');
    assert.equal(resumed.shouldReschedule, true);
    assert.deepEqual(
      await db.queryOne<{ epoch: number; no_progress_count: number; warning_level: number }>(
        'SELECT epoch, no_progress_count, warning_level FROM agent_loop_guards WHERE run_id = ?',
        [runId],
      ),
      { epoch: 2, no_progress_count: 0, warning_level: 0 },
    );
    assert.deepEqual(
      await db.queryOne<{ schedule_state: string }>(
        'SELECT schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
        [runtimeId, runId],
      ),
      { schedule_state: 'runnable' },
    );

    const afterResume = await stateCommit.evaluateToolLoopGuard({
      scope: scenarioScope,
      runId,
      runtimeId,
      expectedRunVersion: resumed.run.version,
      observations: [
        {
          toolName: 'workspace_read_file',
          risk: 'read',
          operationHash: 'repeat-missing-file-operation',
          result: repeatedFailure,
        },
      ],
      now: now + 11,
    });
    assert.equal(afterResume.run.status, 'running');
    assert.equal(afterResume.committedEvents.length, 0, 'new progress epoch must clear the previous repetition streak');

    return [
      { name: 'warnings_before_pause', value: warningTransitions, unit: 'warnings' },
      { name: 'repeated_failures_before_pause', value: 4, unit: 'calls' },
      { name: 'progress_epoch_after_input', value: 2, unit: 'epoch' },
      { name: 'post_resume_repeated_calls_without_pause', value: 1, unit: 'calls' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const publicAgentErrorTaxonomyScenario: Scenario = async () => {
  const routeError = async (rawCode: string): Promise<{ status: number; code: string }> =>
    new Promise((resolve, reject) => {
      let status = 0;
      const response = {
        locals: {},
        headersSent: false,
        setHeader: () => response,
        status: (value: number) => {
          status = value;
          return response;
        },
        json: (body: unknown) => {
          try {
            const error = (body as { error?: { code?: unknown } }).error;
            assert.ok(error && typeof error.code === 'string');
            resolve({ status, code: error.code });
          } catch (error) {
            reject(error);
          }
          return response;
        },
      };
      const request = { header: () => undefined };
      agentRoute(async () => {
        throw new Error(rawCode);
      })(request as never, response as never, (() => undefined) as never);
    });

  const cases: Array<{ producer: string; raw: string; status: number; code: string }> = [
    { producer: 'subagent missing run', raw: 'RUN_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    { producer: 'subagent terminal run', raw: 'RUN_NOT_ACTIVE', status: 409, code: 'RUN_NOT_ACTIVE' },
    {
      producer: 'subagent stale cancel',
      raw: 'DELEGATION_VERSION_CONFLICT',
      status: 409,
      code: 'DELEGATION_VERSION_CONFLICT',
    },
    { producer: 'workspace ACP selection', raw: 'ACP_PROFILE_SELECTION_INVALID', status: 400, code: 'ACP_PROFILE_SELECTION_INVALID' },
    { producer: 'workspace ACP missing', raw: 'ACP_PROFILE_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    { producer: 'workspace browser missing', raw: 'BROWSER_TARGET_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    {
      producer: 'workspace browser incompatible',
      raw: 'BROWSER_TARGET_REQUIRES_BROWSER_RECIPE',
      status: 422,
      code: 'BROWSER_TARGET_REQUIRES_BROWSER_RECIPE',
    },
    { producer: 'plugin storage CAS', raw: 'APP_STORAGE_VERSION_CONFLICT', status: 409, code: 'APP_STORAGE_VERSION_CONFLICT' },
    { producer: 'plugin storage payload', raw: 'APP_STORAGE_VALUE_TOO_LARGE', status: 413, code: 'APP_STORAGE_VALUE_TOO_LARGE' },
    { producer: 'plugin storage quota', raw: 'APP_STORAGE_QUOTA_EXCEEDED', status: 507, code: 'APP_STORAGE_QUOTA_EXCEEDED' },
    { producer: 'workspace artifact import', raw: 'ARTIFACT_NOT_READY', status: 409, code: 'ARTIFACT_NOT_READY' },
    { producer: 'MCP endpoint syntax', raw: 'INTEGRATION_ENDPOINT_INVALID', status: 400, code: 'INTEGRATION_ENDPOINT_INVALID' },
    {
      producer: 'MCP private endpoint policy',
      raw: 'INTEGRATION_PRIVATE_ENDPOINT_DENIED',
      status: 422,
      code: 'INTEGRATION_PRIVATE_ENDPOINT_DENIED',
    },
    {
      producer: 'MCP DNS unavailable',
      raw: 'INTEGRATION_DNS_RESOLUTION_FAILED',
      status: 503,
      code: 'INTEGRATION_DNS_RESOLUTION_FAILED',
    },
  ];
  for (const expected of cases) {
    const actual = await routeError(expected.raw);
    assert.deepEqual(actual, { status: expected.status, code: expected.code }, expected.producer);
    assert.notEqual(actual.status, 500, `${expected.producer} must not degrade to INTERNAL_ERROR`);
  }

  return [
    { name: 'public_error_contract_cases', value: cases.length, unit: 'cases' },
    { name: 'public_errors_degraded_to_500', value: 0, unit: 'cases' },
    { name: 'public_error_status_classes', value: new Set(cases.map((item) => item.status)).size, unit: 'statuses' },
  ];
};

const scenarios = new Map<string, Scenario>([
  ['context/tool-exchange-atomicity', contextToolExchangeScenario],
  ['runtime/restart-recovery-closure', restartRecoveryScenario],
  ['runtime/app-disable-scope-closure', appDisableScopeScenario],
  ['runtime/read-tool-batch-authority', readToolBatchAuthorityScenario],
  ['runtime/subagent-claimed-cancellation', subagentClaimedCancellationScenario],
  ['runtime/subagent-fail-fast-cancellation', failFastSiblingCancellationScenario],
  ['runtime/nested-join-durable-wake', nestedJoinDurableWakeScenario],
  ['runtime/confirmed-mutation-lease-finalization', confirmedMutationLeaseFinalizationScenario],
  ['runtime/mutation-output-projection', mutationOutputProjectionScenario],
  ['runtime/artifact-crash-reconciliation', artifactCrashReconciliationScenario],
  ['runtime/integration-cas-before-runtime', integrationCasBeforeRuntimeScenario],
  ['runtime/integration-refresh-generation', integrationRefreshGenerationScenario],
  ['runtime/idempotency-ttl', idempotencyTtlScenario],
  ['runtime/cumulative-token-ceiling-removed', cumulativeTokenCeilingRemovedScenario],
  ['runtime/progress-aware-loop-guard', progressAwareLoopGuardScenario],
  ['http/public-agent-error-taxonomy', publicAgentErrorTaxonomyScenario],
]);

const main = async (): Promise<void> => {
  const results: ScenarioResult[] = [];
  for (const [name, run] of scenarios) {
    const started = performance.now();
    try {
      const metrics = await run();
      results.push({ name, durationMs: performance.now() - started, metrics });
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        scenarios: results.map((result) => ({
          ...result,
          durationMs: Math.round(result.durationMs * 100) / 100,
        })),
      },
      null,
      2,
    ),
  );
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
