import { randomUUID } from 'node:crypto';
import type {
  CloseAcpPermissionApprovalCommand,
  RequestAcpPermissionApprovalCommand,
  ResolveToolApprovalCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import { TOOL_APPROVAL_TTL_SECONDS } from '../../../../modules/agent/runtime/approvals/approval-policy';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { commandForReplay } from '../../idempotency/command-lifecycle';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import { durableRecord, durableString, parseDurableJson } from '../durable-state-decoders';
import { IDEMPOTENCY_TTL_SECONDS } from './transaction-primitives';

const stateResult = (row: RunRow): StateCommitResult => {
  const run = mapRunRow(row);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents: [] };
};

export const requestAcpPermissionApprovalTransition = async (
  tx: RelationalDatabase,
  command: RequestAcpPermissionApprovalCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.inspection.inputRevision) throw new Error('APPROVAL_STALE');

  const app = await tx.queryOne<{ policy_revision: number }>(
    'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [row.user_id, row.app_id],
  );
  if (!app || app.policy_revision !== command.inspection.policyRevision) {
    throw new Error('POLICY_REVISION_CONFLICT');
  }

  const tool = await tx.queryOne<{ status: string; operation_hash: string; agent_runtime_id: string }>(
    `SELECT status, operation_hash, agent_runtime_id
     FROM agent_tool_calls WHERE id = ? AND run_id = ?`,
    [command.parentToolCallId, row.id],
  );
  if (
    !tool ||
    tool.status !== 'running' ||
    tool.operation_hash !== command.parentOperationHash ||
    tool.agent_runtime_id !== command.runtimeId
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  if (
    command.inspection.risk !== 'mutate' ||
    !command.inspection.mutation ||
    command.expiresAt <= command.now ||
    command.expiresAt > command.now + TOOL_APPROVAL_TTL_SECONDS
  ) {
    throw new Error('VALIDATION_FAILED');
  }

  await tx.execute(
    `INSERT INTO agent_approvals
      (id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
       operation_hash_version, kind, inspection_json, status, policy_revision, input_revision,
       decided_by_user_id, decided_at, consumed_at, requested_at, expires_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'acp_permission', ?, 'requested', ?, ?, NULL, NULL, NULL, ?, ?, 1)`,
    [
      command.approvalId,
      row.user_id,
      row.app_id,
      row.id,
      command.parentToolCallId,
      command.runtimeId,
      command.inspection.operationHash,
      JSON.stringify(command.inspection),
      command.inspection.policyRevision,
      command.inspection.inputRevision,
      command.now,
      command.expiresAt,
    ],
  );
  await tx.execute(
    `UPDATE agent_apps SET approval_count = approval_count + 1, updated_at = ?
     WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );
  return stateResult(row);
};

export const closeAcpPermissionApprovalTransition = async (
  tx: RelationalDatabase,
  command: CloseAcpPermissionApprovalCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  const changed = await tx.execute(
    `UPDATE agent_approvals
     SET status = ?, decided_at = COALESCE(decided_at, ?), version = version + 1
     WHERE id = ? AND run_id = ? AND user_id = ? AND app_id = ?
       AND kind = 'acp_permission' AND status = 'requested' AND version = ?`,
    [command.status, command.now, command.approvalId, row.id, row.user_id, row.app_id, command.expectedApprovalVersion],
  );
  if (changed.changes !== 1) throw new Error('APPROVAL_STALE');
  await tx.execute(
    `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ?
     WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );
  return stateResult(row);
};

export const resolveAcpPermissionApprovalTransition = async (
  tx: RelationalDatabase,
  command: ResolveToolApprovalCommand,
): Promise<StateCommitResult> => {
  const existing = await commandForReplay(tx, command.scope, 'approval.resolve', command.idempotencyKey, command.now);
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    if (!existing.response_json) throw new Error('IDEMPOTENCY_RESPONSE_MISSING');
    const replayRecord = durableRecord(parseDurableJson(existing.response_json));
    if (durableString(replayRecord.approvalId) !== command.approvalId) {
      throw new Error('RECONCILIATION_REQUIRED');
    }
    const replayRunId = durableString(replayRecord.runId);
    const replayRow = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [replayRunId, command.scope.userId, command.scope.appId],
    );
    if (!replayRow) throw new Error('RECONCILIATION_REQUIRED');
    return stateResult(replayRow);
  }

  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.expectedInputRevision) throw new Error('APPROVAL_STALE');

  const app = await tx.queryOne<{ policy_revision: number }>(
    'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [row.user_id, row.app_id],
  );
  if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('APPROVAL_STALE');

  const approval = await tx.queryOne<{
    operation_hash: string;
    status: string;
    version: number;
    policy_revision: number;
    input_revision: number;
    expires_at: number;
    requested_by_runtime_id: string;
    tool_status: string;
    tool_runtime_id: string;
  }>(
    `SELECT a.operation_hash, a.status, a.version, a.policy_revision, a.input_revision, a.expires_at,
            a.requested_by_runtime_id, t.status AS tool_status, t.agent_runtime_id AS tool_runtime_id
     FROM agent_approvals a
     JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
     WHERE a.id = ? AND a.user_id = ? AND a.app_id = ? AND a.run_id = ? AND a.kind = 'acp_permission'`,
    [command.approvalId, row.user_id, row.app_id, row.id],
  );
  if (
    !approval ||
    approval.status !== 'requested' ||
    approval.version !== command.expectedApprovalVersion ||
    approval.operation_hash !== command.operationHash ||
    approval.policy_revision !== command.expectedPolicyRevision ||
    approval.input_revision !== command.expectedInputRevision ||
    approval.expires_at <= command.now ||
    approval.tool_status !== 'running' ||
    approval.tool_runtime_id !== approval.requested_by_runtime_id
  ) {
    throw new Error('APPROVAL_STALE');
  }

  await tx.execute(
    `INSERT INTO agent_commands
      (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
       response_json, result_entity_id, generation, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, 'approval.resolve', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      row.user_id,
      row.app_id,
      command.idempotencyKey,
      command.requestHash,
      command.approvalId,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );
  const changed = await tx.execute(
    `UPDATE agent_approvals
     SET status = ?, decided_by_user_id = ?, decided_at = ?, consumed_at = ?, version = version + 1
     WHERE id = ? AND kind = 'acp_permission' AND status = 'requested' AND version = ? AND expires_at > ?`,
    [
      command.decision,
      command.decidedByUserId,
      command.now,
      command.now,
      command.approvalId,
      command.expectedApprovalVersion,
      command.now,
    ],
  );
  if (changed.changes !== 1) throw new Error('APPROVAL_STALE');
  await tx.execute(
    `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ?
     WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );

  const commandCompleted = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 200, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = 'approval.resolve'
       AND idempotency_key = ? AND status = 'pending'`,
    [
      JSON.stringify({ runId: row.id, approvalId: command.approvalId }),
      command.now,
      row.user_id,
      row.app_id,
      command.idempotencyKey,
    ],
  );
  if (commandCompleted.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return stateResult(row);
};

export const expireOrphanedAcpPermissionApprovals = async (tx: RelationalDatabase, now: number): Promise<number> => {
  const expired = await tx.queryAll<{ id: string; user_id: number; app_id: string }>(
    `SELECT id, user_id, app_id FROM agent_approvals
     WHERE kind = 'acp_permission' AND status = 'requested' AND expires_at <= ?
     ORDER BY expires_at, id`,
    [now],
  );
  let count = 0;
  for (const approval of expired) {
    const changed = await tx.execute(
      `UPDATE agent_approvals SET status = 'expired', decided_at = ?, version = version + 1
       WHERE id = ? AND kind = 'acp_permission' AND status = 'requested' AND expires_at <= ?`,
      [now, approval.id, now],
    );
    if (changed.changes !== 1) continue;
    await tx.execute(
      `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ?
       WHERE user_id = ? AND app_id = ?`,
      [now, approval.user_id, approval.app_id],
    );
    count += 1;
  }
  return count;
};
