import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolInspection } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { requestHash } from '../../../packages/backend/src/modules/agent/runtime/runs/idempotency';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const acpInnerPermissionDurabilityScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-acp-inner-permission-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'acp-inner-permission.sqlite',
    nodeEnv: 'test',
  });
  const now = 1_801_120_000;
  const scope: Scope = { userId: 1, appId: 'acp-inner-durable-app' };
  const runId = 'acp-inner-durable-run';
  const runtimeId = 'acp-inner-durable-runtime';
  const modelStepId = 'acp-inner-durable-model-step';
  const toolStepId = 'acp-inner-durable-tool-step';
  const parentToolCallId = 'acp-inner-durable-parent-tool';
  const parentOperationHash = 'acp-inner-durable-parent-operation';
  const approvalId = 'acp-inner-durable-approval';
  const nestedOperationHash = 'acp-inner-durable-operation';
  try {
    await db.initialize();
    const stateCommit = new SqliteStateCommitAdapter(db);
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'acp-inner-durable-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, policy_revision, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, 1, ?, ?)`,
      [scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('acp-inner-durable-thread', 1, ?, 'ACP inner durable', 'manual', ?, ?)`,
      [scope.appId, now, now],
    );
    const modelRef = { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 };
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         input_revision, created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'acp-inner-durable-thread', 'running', 'in_progress', 'not_started',
               ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [
        runId,
        scope.appId,
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
          model: modelRef,
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
        JSON.stringify({
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          steps: 0,
          subagentMessages: 0,
          subagentMessageBytes: 0,
        }),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, 'owner-acp-inner', ?, ?)`,
      [runtimeId, runId, JSON.stringify(modelRef), now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
        (?, ?, ?, 1, 'model', 'completed', 1, '[]', '[]', ?, ?),
        (?, ?, ?, 2, 'tool', 'running', 1, '[]', '[]', ?, NULL)`,
      [modelStepId, runId, runtimeId, now, now, toolStepId, runId, runtimeId, now],
    );
    const parentInspection: ToolInspection = {
      toolName: 'acp_execute',
      toolVersion: '1.0.0',
      normalizedArguments: { integrationId: '00000000-0000-4000-8000-000000000108' },
      target: {
        kind: 'integration',
        targetIdentity: 'acp:durable',
        endpoint: 'workspace-acp:durable',
        loginUser: 'runner:acp',
        configurationHash: 'acp-durable-config',
      },
      resourceKeys: ['integration:acp:durable', 'workspace:durable:1'],
      risk: 'mutate',
      mutation: true,
      operationHash: parentOperationHash,
      operationHashVersion: 1,
      preconditions: [],
      policyRevision: 1,
      inputRevision: 1,
    };
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'provider-acp-inner', 'acp_execute', '1.0.0',
               ?, ?, 1, 'mutate', 'running', ?, ?)`,
      [
        parentToolCallId,
        runId,
        runtimeId,
        toolStepId,
        modelStepId,
        JSON.stringify(parentInspection),
        parentOperationHash,
        now,
        now,
      ],
    );

    const rawInputSha256 = createHash('sha256').update('{"secret":"redacted"}', 'utf8').digest('hex');
    const nestedInspection: ToolInspection = {
      toolName: 'acp_inner_permission',
      toolVersion: '1.0.0',
      normalizedArguments: {
        parentToolCallId,
        sessionId: 'session-108',
        acpToolCallId: 'inner-tool-108',
        title: 'Write source',
        kind: 'edit',
        rawInputBytes: 21,
        rawInputSha256,
      },
      target: { ...parentInspection.target },
      resourceKeys: [...parentInspection.resourceKeys],
      risk: 'mutate',
      mutation: true,
      operationHash: nestedOperationHash,
      operationHashVersion: 1,
      preconditions: [],
      policyRevision: 1,
      inputRevision: 1,
    };
    const beforeRun = await db.queryOne<{ version: number; status: string }>(
      'SELECT version, status FROM agent_runs WHERE id = ?',
      [runId],
    );
    const requested = await stateCommit.requestAcpPermissionApproval({
      scope,
      runId,
      runtimeId,
      parentToolCallId,
      parentOperationHash,
      approvalId,
      inspection: nestedInspection,
      expiresAt: now + 120,
      now,
    });
    assert.equal(requested.run.status, 'running');
    assert.equal(requested.run.version, beforeRun?.version, 'nested approval request must not mutate Run version');
    const requestedRow = await db.queryOne<{
      kind: string;
      status: string;
      inspection_json: string | null;
      consumed_at: number | null;
    }>('SELECT kind, status, inspection_json, consumed_at FROM agent_approvals WHERE id = ?', [approvalId]);
    assert.equal(requestedRow?.kind, 'acp_permission');
    assert.equal(requestedRow?.status, 'requested');
    assert.equal(requestedRow?.consumed_at, null);
    assert.ok(requestedRow?.inspection_json?.includes(rawInputSha256));
    assert.equal(
      requestedRow?.inspection_json?.includes('redacted'),
      false,
      'ACP raw input must not be copied into durable approval inspection',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>('SELECT status FROM agent_tool_calls WHERE id = ?', [parentToolCallId]))
        ?.status,
      'running',
      'nested approval request must leave the parent mutation Tool running',
    );

    const resolved = await stateCommit.resolveToolApproval({
      scope,
      runId,
      approvalId,
      decision: 'approved',
      operationHash: nestedOperationHash,
      expectedApprovalVersion: 1,
      expectedRunVersion: requested.run.version,
      expectedPolicyRevision: 1,
      expectedInputRevision: 1,
      decidedByUserId: 1,
      idempotencyKey: 'acp-inner-durable-resolution',
      requestHash: requestHash(1, {
        approvalId,
        runId,
        decision: 'approved',
        operationHash: nestedOperationHash,
        expectedVersion: 1,
      }),
      now: now + 1,
    });
    assert.equal(resolved.run.status, 'running');
    assert.equal(resolved.run.version, requested.run.version, 'nested approval resolution must not reschedule the Run');
    const resolvedRow = await db.queryOne<{ status: string; consumed_at: number | null }>(
      'SELECT status, consumed_at FROM agent_approvals WHERE id = ?',
      [approvalId],
    );
    assert.equal(resolvedRow?.status, 'approved');
    assert.equal(resolvedRow?.consumed_at, now + 1, 'ACP allow_once must be consumed in the same durable resolution');
    assert.equal(
      (await db.queryOne<{ status: string }>('SELECT status FROM agent_tool_calls WHERE id = ?', [parentToolCallId]))
        ?.status,
      'running',
    );
    const replayed = await stateCommit.resolveToolApproval({
      scope,
      runId,
      approvalId,
      decision: 'approved',
      operationHash: nestedOperationHash,
      expectedApprovalVersion: 1,
      expectedRunVersion: requested.run.version,
      expectedPolicyRevision: 1,
      expectedInputRevision: 1,
      decidedByUserId: 1,
      idempotencyKey: 'acp-inner-durable-resolution',
      requestHash: requestHash(1, {
        approvalId,
        runId,
        decision: 'approved',
        operationHash: nestedOperationHash,
        expectedVersion: 1,
      }),
      now: now + 1,
    });
    assert.equal(replayed.run.version, resolved.run.version, 'same-key ACP approval replay must return durable state');
    const replayedRow = await db.queryOne<{ version: number; consumed_at: number | null }>(
      'SELECT version, consumed_at FROM agent_approvals WHERE id = ?',
      [approvalId],
    );
    assert.equal(replayedRow?.version, 2, 'idempotent ACP approval replay must not mutate the durable approval again');
    assert.equal(replayedRow?.consumed_at, now + 1);

    const deniedApprovalId = 'acp-inner-durable-denied-approval';
    const deniedOperationHash = 'acp-inner-durable-denied-operation';
    const deniedInspection: ToolInspection = {
      ...nestedInspection,
      normalizedArguments: {
        ...nestedInspection.normalizedArguments,
        acpToolCallId: 'inner-tool-109',
      },
      operationHash: deniedOperationHash,
    };
    const requestedDenied = await stateCommit.requestAcpPermissionApproval({
      scope,
      runId,
      runtimeId,
      parentToolCallId,
      parentOperationHash,
      approvalId: deniedApprovalId,
      inspection: deniedInspection,
      expiresAt: now + 120,
      now: now + 2,
    });
    assert.equal(
      requestedDenied.run.version,
      requested.run.version,
      'a consumed allow_once must free the parent Tool for a later independent inner permission',
    );
    await stateCommit.resolveToolApproval({
      scope,
      runId,
      approvalId: deniedApprovalId,
      decision: 'denied',
      operationHash: deniedOperationHash,
      expectedApprovalVersion: 1,
      expectedRunVersion: requestedDenied.run.version,
      expectedPolicyRevision: 1,
      expectedInputRevision: 1,
      decidedByUserId: 1,
      idempotencyKey: 'acp-inner-durable-denied-resolution',
      requestHash: requestHash(1, {
        approvalId: deniedApprovalId,
        runId,
        decision: 'denied',
        operationHash: deniedOperationHash,
        expectedVersion: 1,
      }),
      now: now + 3,
    });
    const deniedRow = await db.queryOne<{ status: string; consumed_at: number | null }>(
      'SELECT status, consumed_at FROM agent_approvals WHERE id = ?',
      [deniedApprovalId],
    );
    assert.equal(deniedRow?.status, 'denied');
    assert.equal(deniedRow?.consumed_at, now + 3, 'reject_once must also be consumed in the durable decision');

    return [
      { name: 'acp_nested_run_version_changes', value: 0, unit: 'versions' },
      { name: 'acp_nested_parent_tool_interruptions', value: 0, unit: 'tools' },
      { name: 'acp_nested_raw_inputs_persisted', value: 0, unit: 'payloads' },
      {
        name: 'acp_nested_allow_once_consumed',
        value: resolvedRow?.consumed_at === now + 1 ? 1 : 0,
        unit: 'approvals',
      },
      { name: 'acp_nested_idempotent_replays', value: replayedRow?.version === 2 ? 1 : 0, unit: 'approvals' },
      { name: 'acp_nested_reject_once_consumed', value: deniedRow?.consumed_at === now + 3 ? 1 : 0, unit: 'approvals' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
