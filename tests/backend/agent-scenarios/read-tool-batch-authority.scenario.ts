import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const readToolBatchAuthorityScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-read-batch-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'read-batch.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_800_200_000;
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
  const result = (summary: string) => ({
    ok: true,
    summary,
    data: { summary },
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed' as const,
    verification: { status: 'verified' as const, summary: 'scenario verified', evidenceRefs: [] },
  });

  const insertTool = async (
    stepIndex: number,
    suffix: string,
    sourceModelStepId: string,
    batchIndex: number,
    batchSize: number,
  ): Promise<{ toolStepId: string; toolCallId: string }> => {
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
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, created_at)
       VALUES (?, 'read-batch-run', 'read-batch-runtime', ?, ?, ?, ?, ?, 'file_read', '1', '{}', ?, 1,
               'read', 'proposed', ?)`,
      [toolCallId, toolStepId, sourceModelStepId, batchIndex, batchSize, `provider-${suffix}`, `hash-${suffix}`, now],
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

    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('read-batch-model-single', 'read-batch-run', 'read-batch-runtime', 1,
               'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [now, now],
    );
    const single = await insertTool(2, 'single', 'read-batch-model-single', 0, 1);
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

    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('read-batch-model-parallel', 'read-batch-run', 'read-batch-runtime', 3,
               'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [now + 3, now + 3],
    );
    const first = await insertTool(4, 'parallel-a', 'read-batch-model-parallel', 0, 2);
    const second = await insertTool(5, 'parallel-b', 'read-batch-model-parallel', 1, 2);
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
