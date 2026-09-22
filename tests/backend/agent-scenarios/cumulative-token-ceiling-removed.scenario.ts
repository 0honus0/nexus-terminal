import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { parseBudgetIncreaseRequest } from '../../../packages/backend/src/interfaces/http/agent/agent-runtime-route-input';
import { scenarioDelegationModel, SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const cumulativeTokenCeilingRemovedScenario = async () => {
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
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', '[]', 'parent-child', ?, 'continue despite cumulative token telemetry',
               '[]', '[]', '[]', 'settled', 'running', 1, 'isolate', 10,
               'token-ceiling-delegation-key', 'token-ceiling-delegation-hash', ?, 1, ?, ?)`,
      [delegationId, runId, rootRuntimeId, childRuntimeId, scenarioDelegationModel(modelRef), now + 600, now, now],
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
      heuristicInputTokens: 74_000,
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
