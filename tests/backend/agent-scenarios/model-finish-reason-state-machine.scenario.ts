import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { modelFinishDisposition } from '../../../packages/backend/src/modules/agent/runtime/execution/model-finish-policy';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';

export const modelFinishReasonStateMachineScenario = async () => {
  const cases = [
    { reason: 'stop' as const, toolCalls: 0, expected: { kind: 'complete' } },
    { reason: 'tool-calls' as const, toolCalls: 2, expected: { kind: 'tool_calls' } },
    { reason: 'length' as const, toolCalls: 0, expected: { kind: 'failed', errorCode: 'MODEL_OUTPUT_TRUNCATED' } },
    {
      reason: 'content-filter' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_CONTENT_FILTERED' },
    },
    {
      reason: 'error' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_PROVIDER_REPORTED_ERROR' },
    },
    {
      reason: 'other' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_UNSUPPORTED' },
    },
    {
      reason: null,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISSING' },
    },
    {
      reason: 'stop' as const,
      toolCalls: 1,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISMATCH' },
    },
    {
      reason: 'tool-calls' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISMATCH' },
    },
  ];
  for (const item of cases) {
    assert.deepEqual(modelFinishDisposition(item.reason, item.toolCalls), item.expected);
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-finish-reason-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'finish.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const now = 1_800_000_000;
  const runUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  };
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'finish-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('finish-thread', 1, 'scenario-app', 'finish-thread', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES ('finish-run', 1, 'scenario-app', 'finish-thread', 'running', 'in_progress', 'not_started',
               ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
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
          model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
          modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
          rootModelRoutes: [],
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
          environment: null,
          policyRevision: 1,
          settingsRevision: 1,
        }),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify(runUsage),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('finish-runtime', 'finish-run', 'root', 'native', ?, 'running', 'executing', 0,
               'owner-finish-runtime', ?, ?)`,
      [
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('finish-step', 'finish-run', 'finish-runtime', 1, 'model', 'running', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_model_attempts
        (id, step_id, attempt_index, status, reserved_tokens, created_at)
       VALUES ('finish-attempt', 'finish-step', 1, 'streaming', 4096, ?)`,
      [now],
    );

    const settled = await stateCommit.settleModelStep({
      scope,
      runId: 'finish-run',
      runtimeId: 'finish-runtime',
      stepId: 'finish-step',
      attemptId: 'finish-attempt',
      expectedRunVersion: 1,
      assistantEntryId: 'finish-partial-entry',
      assistantText: 'partial output before provider length stop',
      usage: { ...runUsage, inputTokens: 120, outputTokens: 64, steps: 1 },
      inputTokens: 120,
      outputTokens: 64,
      cachedInputTokens: 0,
      estimatedUsage: false,
      finishReason: 'length',
      errorCode: 'MODEL_OUTPUT_TRUNCATED',
      terminalStatus: 'failed',
      now: now + 1,
    });
    assert.equal(settled.run.status, 'failed');
    assert.equal(settled.run.goalStatus, 'not_satisfied');
    assert.equal(settled.run.verificationStatus, 'failed');

    const snapshot = await repository.snapshot(scope, 'finish-run');
    assert.equal(snapshot?.terminalIssue?.errorCode, 'MODEL_OUTPUT_TRUNCATED');
    const partial = await db.queryOne<{ kind: string; payload_json: string }>(
      "SELECT kind, payload_json FROM ai_thread_entries WHERE id = 'finish-partial-entry'",
    );
    assert.equal(partial?.kind, 'assistant_message');
    assert.equal(
      (JSON.parse(partial?.payload_json ?? '{}') as { text?: unknown }).text,
      'partial output before provider length stop',
    );
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return [
    { name: 'finish_reason_policy_cases', value: cases.length, unit: 'cases' },
    { name: 'unsafe_finish_reasons_marked_success', value: 0, unit: 'cases' },
    { name: 'truncated_runs_marked_satisfied', value: 0, unit: 'runs' },
  ];
};
