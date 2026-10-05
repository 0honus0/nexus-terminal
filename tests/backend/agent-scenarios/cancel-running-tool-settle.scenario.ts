import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const cancelRunningToolSettleScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-cancel-running-tool-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'cancel-running-tool.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const runs = new SqliteRunRepository(db);
  const now = 1_800_700_000;
  const scope: Scope = { userId: 1, appId: 'cancel-running-tool-app' };
  const runId = 'cancel-running-tool-run';
  const runtimeId = 'cancel-running-tool-runtime';
  const modelStepId = 'cancel-running-tool-model-step';
  const toolStepId = 'cancel-running-tool-step';
  const toolCallId = 'cancel-running-tool-call';
  const providerCallId = 'cancel-running-tool-provider-call';
  const modelRef = {
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  };
  const budget = {
    modelRequestCeiling: 100,
    activeExecutionCeilingSeconds: 7_200,
    maxToolExecutions: 4_000,
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
  };
  const definition = {
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    requiredModelCapabilities: [],
    model: modelRef,
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'full_access',
    executionMode: 'execute',
    connectionIds: [42],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  };
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    modelRequests: 1,
    toolExecutions: 1,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'cancel-running-tool-user', 'unused')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('cancel-running-tool-thread', 1, ?, 'cancel running tool', 'manual', ?, ?)`,
      [scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'cancel-running-tool-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scope.appId, JSON.stringify(budget), JSON.stringify(definition), JSON.stringify(usage), now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [runtimeId, runId, JSON.stringify(modelRef), `owner-${runtimeId}`, now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
         (?, ?, ?, 1, 'model', 'completed', 0, '[]', '[]', ?, ?),
         (?, ?, ?, 2, 'tool', 'running', 0, '[]', '[]', ?, NULL)`,
      [modelStepId, runId, runtimeId, now, now, toolStepId, runId, runtimeId, now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, 'scenario_mutation', '1.0.0', '{}', 'cancel-operation', 1,
               'mutate', 'running', ?, ?)`,
      [toolCallId, runId, runtimeId, toolStepId, modelStepId, providerCallId, now, now],
    );

    const cancelled = await stateCommit.cancelRun({
      scope,
      runId,
      expectedRunVersion: 1,
      idempotencyKey: 'cancel-running-tool-key',
      requestHash: 'cancel-running-tool-hash',
      now: now + 1,
    });
    assert.equal(cancelled.accepted, true);
    assert.equal(cancelled.run.status, 'cancelling');
    assert.equal(cancelled.run.completedAt, null);

    const settled = await stateCommit.settleMutationTool({
      scope,
      runId,
      runtimeId,
      toolStepId,
      toolCallId,
      expectedRunVersion: 1,
      toolResultEntryId: 'cancel-running-tool-result-entry',
      providerCallId,
      result: {
        ok: false,
        outcome: 'confirmed',
        errorCode: 'OPERATION_ABORTED',
        summary: 'Mutation was aborted after cancellation.',
        artifactRefs: [],
        truncated: false,
        verification: {
          status: 'failed',
          summary: 'The operation ended with a confirmed abort.',
          evidenceRefs: [],
        },
      },
      usage,
      now: now + 2,
    });
    assert.equal(settled.run.status, 'cancelled');
    assert.equal(settled.run.needsReconciliation, false);
    assert.equal(settled.run.completedAt, now + 2);

    const tool = await db.queryOne<{ status: string; result_json: string | null }>(
      'SELECT status, result_json FROM agent_tool_calls WHERE id = ?',
      [toolCallId],
    );
    assert.equal(tool?.status, 'failed');
    assert.equal(JSON.parse(tool?.result_json ?? '{}').outcome, 'confirmed');
    const quarantine = await db.queryOne<{ resource_key: string }>(
      'SELECT resource_key FROM agent_resource_quarantine WHERE owner_id = ? LIMIT 1',
      [runId],
    );
    assert.equal(quarantine, null);

    const staleResourceKey = 'connection:42';
    await db.execute(`INSERT INTO agent_resource_fences (resource_key, next_fence) VALUES (?, 1)`, [staleResourceKey]);
    await db.execute(
      `INSERT INTO agent_resource_quarantine
        (resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at)
       VALUES (?, ?, 'agent', ?, 'STATE_COMMIT_FAILED_AFTER_MUTATION', '{}', 1, ?)`,
      [staleResourceKey, toolCallId, runtimeId, now + 3],
    );
    const staleProjection = await runs.reconciliation(scope, runId);
    assert.equal(staleProjection.required, true);
    assert.equal(staleProjection.resources.length, 1);

    const recovered = await stateCommit.resolveRunReconciliation({
      scope,
      runId,
      expectedRunVersion: settled.run.version,
      note: 'Scenario verifies quarantine is authoritative even when the run flag is stale.',
      resources: [{ resourceKey: staleResourceKey, version: 1 }],
      now: now + 4,
    });
    assert.equal(recovered.run.needsReconciliation, false);
    assert.equal((await runs.reconciliation(scope, runId)).required, false);

    return [
      { name: 'running_tools_hold_cancellation_open', value: 1, unit: 'tools' },
      { name: 'cancelled_tools_durably_settled', value: 1, unit: 'tools' },
      { name: 'stale_quarantine_recoveries', value: 1, unit: 'resources' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
