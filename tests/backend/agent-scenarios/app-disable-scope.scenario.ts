import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort } from '../../../packages/backend/src/modules/agent/agent.types';
import { AgentSettingsService } from '../../../packages/backend/src/modules/agent/host/agent-settings.service';
import type { AgentBackendPort } from '../../../packages/backend/src/modules/agent/runtime/execution/agent-backend.port';
import { AgentEventHub } from '../../../packages/backend/src/modules/agent/runtime/events/event-hub';
import { AgentScheduler } from '../../../packages/backend/src/modules/agent/runtime/scheduling/scheduler';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { scenarioDelegationModel, SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const appDisableScopeScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-disable-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'disable.sqlite', nodeEnv: 'test' });
  const disableObserverEvents: Array<{ runId: string; type: string }> = [];
  const stateCommit = new SqliteStateCommitAdapter(db, (run, events) => {
    for (const event of events) disableObserverEvents.push({ runId: run.id, type: event.type });
  });
  const now = 1_800_100_000;
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
    model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
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
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, created_at, updated_at)
       VALUES ('scope-delegation-target', 'scope-run-target', 'scope-root-target', 'scope-child-target', 'default',
               '[]', 'parent-child', ?, 'scenario child', '[]', '[]', '[]', 'settled', 'running', 1, 'isolate',
               10, 'scope-delegation-key', 'scope-delegation-hash', ?, ?, ?)`,
      [scenarioDelegationModel(modelRef), now + 600, now, now],
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
    assert.deepEqual(
      disableObserverEvents.filter((item) => item.type === 'run.interrupted'),
      [{ runId: 'scope-run-target', type: 'run.interrupted' }],
      'app-scope interruption must project only the committed target transition',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_runs WHERE id = 'scope-run-target'"))?.status,
      'interrupted',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_runs WHERE id = 'scope-run-other-app'"))?.status,
      'running',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_runs WHERE id = 'scope-run-other-user'"))
        ?.status,
      'running',
    );
    assert.equal(
      (
        await db.queryOne<{ status: string }>(
          "SELECT status FROM agent_delegations WHERE id = 'scope-delegation-target'",
        )
      )?.status,
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
      (
        await db.queryOne<{ running_count: number }>(
          "SELECT running_count FROM agent_apps WHERE user_id = 1 AND app_id = 'scope-app-a'",
        )
      )?.running_count,
      0,
    );
    assert.equal(
      (
        await db.queryOne<{ running_count: number }>(
          "SELECT running_count FROM agent_apps WHERE user_id = 2 AND app_id = 'scope-app-a'",
        )
      )?.running_count,
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
  const scheduler = new AgentScheduler(settings, backend, new AgentEventHub(), schedulerClock, async () => 0);
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
