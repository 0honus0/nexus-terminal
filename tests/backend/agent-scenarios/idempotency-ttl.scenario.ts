import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const idempotencyTtlScenario = async () => {
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
  };
  const definition = {
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    requiredModelCapabilities: [],
    model: modelRef,
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
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
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'idempotency-ttl-user', 'not-used')",
    );
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
      [
        runId,
        scope.appId,
        threadId,
        JSON.stringify(budget),
        JSON.stringify(definition),
        JSON.stringify(usage),
        now,
        now,
        now,
      ],
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
      (
        await db.queryOne<{ count: number }>(
          `SELECT COUNT(*) AS count FROM agent_commands
         WHERE command_name = 'scenario.cleanup' AND status = 'committed' AND expires_at <= ?`,
          [now],
        )
      )?.count,
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
      (await db.queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM agent_commands WHERE id = 'cleanup-future'"))
        ?.count,
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
