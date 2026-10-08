import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteSubagentRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-subagent.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { childHistoryHash } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-history';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import { SubagentModelStepExecutor } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-model-step-executor';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { CHECKPOINT_SECTIONS } from '../../../packages/backend/src/modules/agent/ai/context-checkpoint.service';
import { ScenarioModelCallLimiter } from './scenario-benchmark-helpers';
import { emptyModelContinuations } from './scenario-fixtures';
import type { LanguageModelPort } from '../../../packages/backend/src/modules/agent/ai/language-model.port';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { AgentSettingsService } from '../../../packages/backend/src/modules/agent/host/agent-settings.service';
import { SubagentParticipantExecutor } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-participant-executor';
import { SubagentScheduler } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-scheduler';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { scenarioDelegationModel, SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const subagentClaimedCancellationScenario = async () => {
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
    modelRequestCeiling: 100,
    activeExecutionCeilingSeconds: 7200,
    maxToolExecutions: 4000,
    phase: 'executing',
    stopReason: null,
    extensionCount: 0,
    progressSequence: 0,

    maxModelRequests: 100,
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
    model: JSON.parse(modelRef),
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    toolExecutions: 0,
    modelRequests: 0,
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
      [
        runtimeId,
        runId,
        `child:${suffix}`,
        modelRef,
        runtimeStatus,
        scheduleState,
        `owner-${runtimeId}`,
        now,
        updatedAt,
      ],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_model_requests, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at, completed_at)
       VALUES (?, ?, 'subagent-root-runtime', ?, 'default', '[]', 'parent-child', ?, ?, '[]', '[]', '[]',
               'settled', ?, 1, 'isolate', 10, ?, ?, ?, 1, ?, ?, ?)`,
      [
        delegationId,
        runId,
        runtimeId,
        scenarioDelegationModel(modelRef),
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
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'subagent-cancel-user', 'not-used')",
    );
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

    const summaryChild = await insertChild('summary', { workStatus: 'claimed', ownerEpoch: 7 });
    await db.execute(
      `INSERT INTO agent_messages (id, run_id, sender_runtime_id, recipient_runtime_id, delegation_id, recipient_sequence, kind, correlation_id, task_revision, body_json, artifact_refs_json, size_bytes, status, idempotency_key, payload_hash, created_at, expires_at, consumed_at)
      VALUES ('consumed-correction', ?, 'subagent-root-runtime', ?, ?, 1, 'request', 'correction', 1, '{"text":"Preserve generated files"}', '[]', 50, 'consumed', 'correction-key', 'correction-hash', ?, ?, ?)`,
      [runId, summaryChild.runtimeId, summaryChild.delegationId, now - 1, now + 100, now],
    );
    await db.execute(`UPDATE agent_runtimes SET consumed_mailbox_sequence = 1 WHERE id = ?`, [summaryChild.runtimeId]);
    const history = await repository.contextHistory(scope, runId, summaryChild.runtimeId);
    assert.equal(history.units.length, 1);
    assert.equal(history.units[0]?.mailbox?.status, 'consumed');
    assert.match(JSON.stringify(history.units), /Preserve generated files/);
    assert.equal(
      (await repository.contextHistory(scope, runId, 'subagent-root-runtime')).units.length,
      0,
      'child history must not leak to another runtime',
    );
    const commit = new SqliteStateCommitAdapter(db);
    const beginSummary = () =>
      commit.beginSubagentModelStep({
        scope,
        runId,
        runtimeId: summaryChild.runtimeId,
        delegationId: summaryChild.delegationId,
        workId: summaryChild.workId,
        ownerEpoch: 7,
        reservedTokens: 500,
        purpose: 'compaction',
        now,
      });
    const begun = await beginSummary();
    await assert.rejects(
      commit.appendInput({
        scope,
        runId,
        inputEntryId: 'child-only-interrupt',
        input: { text: 'Interrupt Root only.', artifactRefs: [] },
        mode: 'interrupt',
        expectedRunVersion: begun.run.version,
        idempotencyKey: 'child-only-interrupt',
        requestHash: 'child-only-interrupt',
        now,
      }),
      /RUN_NOT_STREAMING_MODEL/,
      'Child-only streaming must not accept a Root interrupt',
    );
    const checkpoint = {
      version: 'semantic-child-v1' as const,
      throughId: history.units[0]!.id,
      sourceHash: childHistoryHash(history.units),
      content: 'Preserve generated files.',
    };
    const summaryCommand = {
      scope,
      runId,
      runtimeId: summaryChild.runtimeId,
      delegationId: summaryChild.delegationId,
      workId: summaryChild.workId,
      ownerEpoch: 7,
      stepId: begun.stepId,
      attemptId: begun.attemptId,
      outcome: 'completed' as const,
      result: null,
      evidenceRefs: [],
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 5,
      estimatedUsage: false,
      finishReason: 'stop' as const,
      contextCheckpoint: checkpoint,
      now,
    };
    const settled = await commit.settleSubagentModelStep(summaryCommand);
    assert.equal(settled.run.usage.modelRequests, 1);
    assert.equal(settled.run.usage.inputTokens, 100);
    assert.equal((await repository.delegation(scope, runId, summaryChild.delegationId))?.status, 'running');
    assert.equal((await repository.delegation(scope, runId, summaryChild.delegationId))?.usage.tokens, 120);
    assert.equal((await repository.runtime(scope, runId, summaryChild.runtimeId))?.consumedMailboxSequence, 1);
    assert.deepEqual((await repository.contextHistory(scope, runId, summaryChild.runtimeId)).checkpoint, checkpoint);
    await assert.rejects(commit.settleSubagentModelStep(summaryCommand), /ATTEMPT_STATE_CONFLICT/);
    const stale = await beginSummary();
    await assert.rejects(
      commit.settleSubagentModelStep({
        ...summaryCommand,
        stepId: stale.stepId,
        attemptId: stale.attemptId,
        contextCheckpoint: { ...checkpoint, sourceHash: '0'.repeat(64) },
      }),
      /CONTEXT_COMPACTION_SOURCE_CHANGED/,
    );
    assert.deepEqual(
      (await repository.contextHistory(scope, runId, summaryChild.runtimeId)).checkpoint,
      checkpoint,
      'failed transaction must preserve the prior checkpoint',
    );
    await commit.settleSubagentModelStep({
      ...summaryCommand,
      stepId: stale.stepId,
      attemptId: stale.attemptId,
      contextCheckpoint: undefined,
      outcome: 'failed',
      finishReason: 'length',
      errorCode: 'CONTEXT_COMPACTION_INCOMPLETE',
    });

    const orchestrated = await insertChild('context-orchestration', { workStatus: 'claimed', ownerEpoch: 9 });
    await db.execute(`UPDATE agent_delegations SET model_ref_json = ?, max_model_requests = 24 WHERE id = ?`, [
      JSON.stringify({
        ...JSON.parse(modelRef),
        modelCapabilities: { ...SCENARIO_MODEL_CAPABILITIES, contextWindow: 4096, maxOutputTokens: 512 },
      }),
      orchestrated.delegationId,
    ]);
    for (let index = 0; index < 18; index += 1)
      await db.execute(
        `INSERT INTO agent_messages (id, run_id, sender_runtime_id, recipient_runtime_id, delegation_id, recipient_sequence, kind, correlation_id, task_revision, body_json, artifact_refs_json, size_bytes, status, idempotency_key, payload_hash, created_at, expires_at, consumed_at)
      VALUES (?, ?, 'subagent-root-runtime', ?, ?, ?, 'request', 'history', 1, ?, '[]', 2200, 'consumed', ?, 'hash', ?, ?, ?)`,
        [
          `child-history-${index}`,
          runId,
          orchestrated.runtimeId,
          orchestrated.delegationId,
          index + 1,
          JSON.stringify({
            text: `${index === 0 ? 'EARLY_PARENT_CONSTRAINT: preserve source maps. ' : ''}${'Historical evidence. '.repeat(100)}`,
          }),
          `history-${index}`,
          now - 20 + index,
          now + 100,
          now,
        ],
      );
    await db.execute(`UPDATE agent_runtimes SET consumed_mailbox_sequence = 18 WHERE id = ?`, [orchestrated.runtimeId]);
    await db.execute(
      `INSERT INTO agent_messages (id, run_id, sender_runtime_id, recipient_runtime_id, delegation_id, recipient_sequence, kind, correlation_id, task_revision, body_json, artifact_refs_json, size_bytes, status, idempotency_key, payload_hash, created_at, expires_at)
      VALUES ('pending-child-correction', ?, 'subagent-root-runtime', ?, ?, 19, 'request', 'pending', 1, '{"text":"PENDING_CORRECTION: inspect source maps"}', '[]', 50, 'accepted', 'pending-correction', 'hash', ?, ?)`,
      [runId, orchestrated.runtimeId, orchestrated.delegationId, now, now + 100],
    );
    let privateCalls = 0;
    let visibleDeltas = 0;
    let summaryFailure: 'length' | 'cancel' | null = null;
    let requestController = new AbortController();
    const summary = CHECKPOINT_SECTIONS.map(
      (section) =>
        `## ${section}\n${section === 'Requirements' ? 'EARLY_PARENT_CONSTRAINT: preserve source maps.' : '(none)'}`,
    ).join('\n');
    const modelPort = {
      async *stream(request) {
        const compaction = request.instructions.some((instruction) => instruction.includes('task handoff'));
        if (compaction) {
          privateCalls += 1;
          assert.equal(request.toolMode, 'none');
          assert.doesNotMatch(JSON.stringify(request.messages), /PENDING_CORRECTION/);
          if (!summaryFailure)
            assert.equal(
              (await repository.runtime(scope, runId, orchestrated.runtimeId))?.consumedMailboxSequence,
              18,
              'summary batches must not consume pending inbox',
            );
        } else {
          assert.match(JSON.stringify(request.messages), /EARLY_PARENT_CONSTRAINT/);
          assert.match(JSON.stringify(request.messages), /PENDING_CORRECTION/);
        }
        yield { type: 'message.delta', text: compaction ? summary : 'Child work complete.' };
        yield { type: 'usage', usage: { inputTokens: 200, outputTokens: 40, cachedInputTokens: 10 } };
        if (compaction && summaryFailure === 'cancel') requestController.abort();
        yield { type: 'completed', finishReason: compaction && summaryFailure === 'length' ? 'length' : 'stop' };
      },
    } as LanguageModelPort;
    const runs = new SqliteRunRepository(db);
    const builder = new SubagentContextBuilder(
      repository,
      repository,
      { discover: () => [], list: () => [] } as never,
      new CapabilityRegistry(),
      emptyModelContinuations,
      null!,
      schedulerClock,
    );
    const executor = new SubagentModelStepExecutor(
      repository,
      repository,
      repository,
      repository,
      runs,
      {
        get: async () => ({
          enabled: true,
          version: 1,
          models: [{ id: 'scenario-model', ...SCENARIO_MODEL_CAPABILITIES }],
        }),
      } as never,
      modelPort,
      new ScenarioModelCallLimiter(),
      commit,
      builder,
      null!,
      {
        verifiedRuntimeEvidence: async () => ({ artifactRefs: [], tools: [] }),
        completeModelResult: async () => undefined,
        failBeforeModel: async (...args: unknown[]) => {
          throw new Error(`UNEXPECTED_EARLY_FAILURE:${args.at(-1)}`);
        },
      } as never,
      {
        publishRunWake: () => undefined,
        publishTransient: () => {
          visibleDeltas += 1;
        },
      } as never,
      schedulerClock,
    );
    const claimed = (await db.queryOne<{ version: number }>('SELECT version FROM agent_scheduler_work WHERE id = ?', [
      orchestrated.workId,
    ]))!;
    await executor.execute(
      scope,
      {
        id: orchestrated.workId,
        runId,
        agentRuntimeId: orchestrated.runtimeId,
        kind: 'model_step',
        status: 'claimed',
        payload: { delegationId: orchestrated.delegationId },
        ownerEpoch: 9,
        version: claimed.version,
      } as never,
      9,
      requestController.signal,
    );
    assert.ok(
      privateCalls > 1,
      `production child executor must run multiple governed summary batches: ${privateCalls}, ${JSON.stringify(await repository.delegation(scope, runId, orchestrated.delegationId))}`,
    );
    assert.equal(visibleDeltas, 1, 'private summary text must not be shown as a child reply');
    const finishedChild = (await repository.delegation(scope, runId, orchestrated.delegationId))!;
    assert.equal(finishedChild.status, 'completed');
    assert.equal(finishedChild.usage.modelRequests, privateCalls + 1);
    assert.equal(finishedChild.usage.tokens, (privateCalls + 1) * 240);
    assert.equal((await repository.runtime(scope, runId, orchestrated.runtimeId))?.consumedMailboxSequence, 19);

    const retryChild = await insertChild('transient-model-retry', { workStatus: 'claimed', ownerEpoch: 9 });
    let retryCalls = 0;
    let lifecycleController: AbortController | undefined;
    let throwOnQuiesce = false;
    const retryExecutor = new SubagentModelStepExecutor(
      repository,
      repository,
      repository,
      repository,
      runs,
      {
        get: async () => ({
          enabled: true,
          version: 1,
          models: [{ id: 'scenario-model', ...SCENARIO_MODEL_CAPABILITIES }],
        }),
      } as never,
      {
        async *stream() {
          retryCalls += 1;
          yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 0 } };
          if (lifecycleController) {
            lifecycleController.abort(new Error('AGENT_QUIESCE'));
            if (throwOnQuiesce) throw lifecycleController.signal.reason;
            yield { type: 'message.delta', text: 'Uncommitted partial reply.' };
            yield { type: 'completed', finishReason: 'stop' };
            return;
          }
          if (retryCalls === 1) throw new Error('PROVIDER_HTTP_503');
          yield { type: 'message.delta', text: 'Recovered child.' };
          yield { type: 'completed', finishReason: 'stop' };
        },
      } as LanguageModelPort,
      new ScenarioModelCallLimiter(),
      commit,
      builder,
      null!,
      {
        verifiedRuntimeEvidence: async () => ({ artifactRefs: [], tools: [] }),
        completeModelResult: async () => undefined,
        failBeforeModel: async (...args: unknown[]) => {
          throw new Error(`UNEXPECTED_RETRY_FAILURE:${args.at(-1)}`);
        },
      } as never,
      { publishRunWake: () => undefined, publishTransient: () => undefined } as never,
      schedulerClock,
    );
    await retryExecutor.execute(
      scope,
      {
        id: retryChild.workId,
        runId,
        agentRuntimeId: retryChild.runtimeId,
        kind: 'model_step',
        status: 'claimed',
        payload: { delegationId: retryChild.delegationId },
        deadlineAt: now + 100,
        ownerEpoch: 9,
      } as never,
      9,
      new AbortController().signal,
    );
    assert.equal((await repository.delegation(scope, runId, retryChild.delegationId))?.status, 'running');
    assert.equal(
      (await repository.delegation(scope, runId, retryChild.delegationId))?.usage.tokens,
      25,
      'failed retry attempt usage must be durable',
    );
    const retryWork = (await db.queryOne<{ id: string; payload_json: string; not_before: number; deadline_at: number }>(
      "SELECT id, payload_json, not_before, deadline_at FROM agent_scheduler_work WHERE agent_runtime_id = ? AND status = 'queued'",
      [retryChild.runtimeId],
    ))!;
    assert.ok(retryWork.not_before > now && retryWork.not_before < retryWork.deadline_at);
    assert.equal(JSON.parse(retryWork.payload_json).retryAttemptIndex, 2);
    await db.execute("UPDATE agent_scheduler_work SET status = 'claimed', owner_epoch = 9 WHERE id = ?", [
      retryWork.id,
    ]);
    await retryExecutor.execute(
      scope,
      {
        id: retryWork.id,
        runId,
        agentRuntimeId: retryChild.runtimeId,
        kind: 'model_step',
        status: 'claimed',
        payload: JSON.parse(retryWork.payload_json),
        deadlineAt: retryWork.deadline_at,
        ownerEpoch: 9,
      } as never,
      9,
      new AbortController().signal,
    );
    assert.equal((await repository.delegation(scope, runId, retryChild.delegationId))?.status, 'completed');
    assert.equal((await repository.delegation(scope, runId, retryChild.delegationId))?.usage.tokens, 50);
    assert.equal(retryCalls, 2);

    for (const throws of [false, true]) {
      throwOnQuiesce = throws;
      const quiescedChild = await insertChild(`quiesced-model-${throws}`, { workStatus: 'claimed', ownerEpoch: 9 });
      lifecycleController = new AbortController();
      await retryExecutor.execute(
        scope,
        {
          id: quiescedChild.workId,
          runId,
          agentRuntimeId: quiescedChild.runtimeId,
          kind: 'model_step',
          status: 'claimed',
          payload: { delegationId: quiescedChild.delegationId },
          deadlineAt: now + 100,
          ownerEpoch: 9,
        } as never,
        9,
        lifecycleController.signal,
      );
      assert.equal((await repository.delegation(scope, runId, quiescedChild.delegationId))?.status, 'running');
      assert.equal(
        (
          await db.queryOne<{ status: string }>('SELECT status FROM agent_scheduler_work WHERE id = ?', [
            quiescedChild.workId,
          ])
        )?.status,
        'claimed',
        'quiesce must leave durable work to lifecycle recovery, not terminal cancellation',
      );
      assert.equal(
        (
          await db.queryOne<{ count: number }>(
            "SELECT COUNT(*) AS count FROM agent_events WHERE run_id = ? AND type IN ('subagent.cancelled','subagent.completed','subagent.failed') AND json_extract(payload_json, '$.runtimeId') = ?",
            [runId, quiescedChild.runtimeId],
          )
        )?.count,
        0,
      );
      lifecycleController = undefined;
    }

    for (const mode of ['length', 'cancel'] as const) {
      summaryFailure = mode;
      requestController = new AbortController();
      const child = await insertChild(`summary-${mode}`, { workStatus: 'claimed', ownerEpoch: 9 });
      await db.execute(`UPDATE agent_delegations SET model_ref_json = ?, max_model_requests = 24 WHERE id = ?`, [
        JSON.stringify({
          ...JSON.parse(modelRef),
          modelCapabilities: { ...SCENARIO_MODEL_CAPABILITIES, contextWindow: 4096, maxOutputTokens: 512 },
        }),
        child.delegationId,
      ]);
      await db.execute(
        `INSERT INTO agent_messages (id, run_id, sender_runtime_id, recipient_runtime_id, delegation_id, recipient_sequence, kind, correlation_id, task_revision, body_json, artifact_refs_json, size_bytes, status, idempotency_key, payload_hash, created_at, expires_at, consumed_at)
        SELECT id || ?, run_id, sender_runtime_id, ?, ?, recipient_sequence, kind, correlation_id, task_revision, body_json, artifact_refs_json, size_bytes, status, idempotency_key, payload_hash, created_at, expires_at, consumed_at FROM agent_messages WHERE recipient_runtime_id = ? AND recipient_sequence <= 18`,
        [mode, child.runtimeId, child.delegationId, orchestrated.runtimeId],
      );
      await db.execute(`UPDATE agent_runtimes SET consumed_mailbox_sequence = 18 WHERE id = ?`, [child.runtimeId]);
      const oldHistory = await repository.contextHistory(scope, runId, child.runtimeId);
      const oldCheckpoint = {
        ...checkpoint,
        throughId: oldHistory.units[0]!.id,
        sourceHash: childHistoryHash(oldHistory.units.slice(0, 1)),
        content: summary,
      };
      await db.execute(`INSERT INTO agent_runtime_context_checkpoints (runtime_id, checkpoint_json) VALUES (?, ?)`, [
        child.runtimeId,
        JSON.stringify(oldCheckpoint),
      ]);
      await executor.execute(
        scope,
        {
          id: child.workId,
          runId,
          agentRuntimeId: child.runtimeId,
          kind: 'model_step',
          status: 'claimed',
          payload: { delegationId: child.delegationId },
          ownerEpoch: 9,
          version: 1,
        } as never,
        9,
        requestController.signal,
      );
      const failed = (await repository.delegation(scope, runId, child.delegationId))!;
      assert.equal(failed.status, mode === 'cancel' ? 'cancelled' : 'failed');
      assert.equal(failed.usage.tokens, 240, 'failed summary usage must still settle once');
      assert.equal(failed.usage.modelRequests, 1);
      assert.doesNotMatch(
        JSON.stringify(failed.result),
        /EARLY_PARENT_CONSTRAINT/,
        'private failed summary must not leak into the child result',
      );
      assert.deepEqual((await repository.contextHistory(scope, runId, child.runtimeId)).checkpoint, oldCheckpoint);
      assert.equal((await repository.runtime(scope, runId, child.runtimeId))?.consumedMailboxSequence, 18);
    }
    assert.equal(visibleDeltas, 1);

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
    assert.equal(
      lateSettleReturned,
      true,
      'a late worker settle must be an idempotent no-op after durable cancellation',
    );
    assert.ok(started.includes(next.workId), 'another child must continue scheduling without a backend restart');
    assert.deepEqual(
      await db.queryOne<{ status: string; owner_epoch: number | null }>(
        'SELECT status, owner_epoch FROM agent_scheduler_work WHERE id = ?',
        [target.workId],
      ),
      { status: 'cancelled', owner_epoch: null },
    );
    assert.equal(
      (
        await db.queryOne<{ status: string }>('SELECT status FROM agent_delegations WHERE id = ?', [
          target.delegationId,
        ])
      )?.status,
      'cancelled',
    );

    for (let index = 0; index < 100; index += 1) {
      const status = await db.queryOne<{ status: string }>('SELECT status FROM agent_scheduler_work WHERE id = ?', [
        next.workId,
      ]);
      if (status?.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(
      (await db.queryOne<{ status: string }>('SELECT status FROM agent_scheduler_work WHERE id = ?', [next.workId]))
        ?.status,
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
