import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const progressAwareLoopGuardScenario = async () => {
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
            toolName: 'file_read',
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
          toolName: 'file_read',
          risk: 'read',
          operationHash: 'repeat-missing-file-operation',
          result: repeatedFailure,
        },
      ],
      now: now + 11,
    });
    assert.equal(afterResume.run.status, 'running');
    assert.equal(afterResume.committedEvents.length, 0, 'new progress epoch must clear the previous repetition streak');

    const stableReadResult = {
      ok: true,
      summary: 'Found the same authorized connection.',
      data: { connectionIds: [1] },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed' as const,
      verification: {
        status: 'verified' as const,
        summary: 'Stable connection inventory confirmed.',
        evidenceRefs: [],
      },
    };
    let mixedVersion = afterResume.run.version;
    let mixedWarnings = 0;
    let mixedStatus = afterResume.run.status;
    for (let index = 1; index <= 5; index += 1) {
      const readGuard = await stateCommit.evaluateToolLoopGuard({
        scope: scenarioScope,
        runId,
        runtimeId,
        expectedRunVersion: mixedVersion,
        observations: [
          {
            toolName: 'machine_list_connections',
            risk: 'read',
            operationHash: 'stable-connection-inventory',
            result: stableReadResult,
          },
        ],
        now: now + 20 + index * 2,
      });
      mixedWarnings += readGuard.committedEvents.filter((event) => event.type === 'run.loop_warning').length;
      mixedVersion = readGuard.run.version;
      mixedStatus = readGuard.run.status;
      if (mixedStatus === 'awaiting_input') break;

      const mutationGuard = await stateCommit.evaluateToolLoopGuard({
        scope: scenarioScope,
        runId,
        runtimeId,
        expectedRunVersion: mixedVersion,
        observations: [
          {
            toolName: 'shell_execute',
            risk: 'mutate',
            operationHash: `unique-shell-operation-${index}`,
            result: {
              ok: true,
              summary: `Shell mutation ${index} completed.`,
              data: { round: index },
              artifactRefs: [],
              truncated: false,
              outcome: 'confirmed' as const,
              verification: {
                status: 'verified' as const,
                summary: `Shell mutation ${index} verified.`,
                evidenceRefs: [],
              },
            },
          },
        ],
        now: now + 21 + index * 2,
      });
      mixedVersion = mutationGuard.run.version;
      mixedStatus = mutationGuard.run.status;
    }
    assert.equal(
      mixedStatus,
      'awaiting_input',
      'stable read observations interleaved with unique successful mutations must not evade loop protection',
    );
    assert.equal(mixedWarnings, 2, 'mixed read/mutation repetition must warn before pausing');
    const mixedGuard = await db.queryOne<{ last_reason: string | null; paused_runtime_id: string | null }>(
      'SELECT last_reason, paused_runtime_id FROM agent_loop_guards WHERE run_id = ?',
      [runId],
    );
    assert.deepEqual(mixedGuard, {
      last_reason: 'repeated_stable_observation',
      paused_runtime_id: runtimeId,
    });

    return [
      { name: 'warnings_before_pause', value: warningTransitions, unit: 'warnings' },
      { name: 'repeated_failures_before_pause', value: 4, unit: 'calls' },
      { name: 'progress_epoch_after_input', value: 2, unit: 'epoch' },
      { name: 'post_resume_repeated_calls_without_pause', value: 1, unit: 'calls' },
      { name: 'mixed_batch_loop_warnings', value: mixedWarnings, unit: 'warnings' },
      { name: 'mixed_batch_loop_pauses', value: mixedStatus === 'awaiting_input' ? 1 : 0, unit: 'pauses' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
