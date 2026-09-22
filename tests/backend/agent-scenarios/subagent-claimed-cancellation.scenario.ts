import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteSubagentRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-subagent.repository';
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
    environment: null,
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
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
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
