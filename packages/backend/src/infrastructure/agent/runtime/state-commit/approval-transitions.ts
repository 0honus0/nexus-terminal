import { randomUUID } from 'node:crypto';
import type {
  DurableEventInput,
  RequestToolApprovalCommand,
  ResolveToolApprovalCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunView } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import {
  allocateHostEvent,
  appendEvents,
  appendLedger,
  IDEMPOTENCY_TTL_SECONDS,
  patchRun,
  summaryPayload,
} from './transaction-primitives';

interface CommandRow {
  status: 'pending' | 'committed' | 'unknown';
  request_hash: string;
  response_json: string | null;
}

export const requestToolApprovalTransition = async (
  tx: RelationalDatabase,
  command: RequestToolApprovalCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.inspection.inputRevision) throw new Error('APPROVAL_STALE');
  const app = await tx.queryOne<{ policy_revision: number }>(
    'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [row.user_id, row.app_id],
  );
  if (!app || app.policy_revision !== command.inspection.policyRevision) throw new Error('POLICY_REVISION_CONFLICT');
  const tool = await tx.queryOne<{ status: string; operation_hash: string; risk: string }>(
    'SELECT status, operation_hash, risk FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
    [command.toolCallId, command.runId, command.toolStepId],
  );
  if (
    !tool ||
    tool.status !== 'proposed' ||
    tool.operation_hash !== command.inspection.operationHash ||
    tool.risk === 'read'
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  if (command.expiresAt <= command.now || command.expiresAt > command.now + 600) throw new Error('VALIDATION_FAILED');
  await tx.execute(
    `INSERT INTO agent_approvals
      (id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
       operation_hash_version, status, policy_revision, input_revision, decided_by_user_id,
       decided_at, consumed_at, requested_at, expires_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'requested', ?, ?, NULL, NULL, NULL, ?, ?, 1)`,
    [
      command.approvalId,
      row.user_id,
      row.app_id,
      row.id,
      command.toolCallId,
      command.runtimeId,
      command.inspection.operationHash,
      command.inspection.policyRevision,
      command.inspection.inputRevision,
      command.now,
      command.expiresAt,
    ],
  );
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'awaiting_approval', version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'proposed'`,
    [command.toolCallId, row.id],
  );
  if (toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'waiting_approval', updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.runtimeId, command.runId],
  );
  const events: DurableEventInput[] = [
    {
      type: 'approval.requested',
      payload: {
        approvalId: command.approvalId,
        toolCallId: command.toolCallId,
        operationHash: command.inspection.operationHash,
        expiresAt: command.expiresAt,
        risk: command.inspection.risk,
      },
    },
    { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_approval' } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, { status: 'awaiting_approval' }, events.length, command.now);
  await tx.execute(
    `UPDATE agent_apps SET approval_count = approval_count + 1, updated_at = ? WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const resolveToolApprovalTransition = async (
  tx: RelationalDatabase,
  command: ResolveToolApprovalCommand,
): Promise<StateCommitResult> => {
  const existing = await tx.queryOne<CommandRow>(
    `SELECT status, request_hash, response_json FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = 'approval.resolve' AND idempotency_key = ?`,
    [command.scope.userId, command.scope.appId, command.idempotencyKey],
  );
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    if (!existing.response_json) throw new Error('IDEMPOTENCY_RESPONSE_MISSING');
    const replay = JSON.parse(existing.response_json) as { runId: string; approvalId: string };
    if (replay.approvalId !== command.approvalId) throw new Error('RECONCILIATION_REQUIRED');
    const replayRow = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [replay.runId, command.scope.userId, command.scope.appId],
    );
    if (!replayRow) throw new Error('RECONCILIATION_REQUIRED');
    const run = mapRunRow(replayRow);
    return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents: [] };
  }
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'awaiting_approval')
    throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.expectedInputRevision) throw new Error('APPROVAL_STALE');
  const app = await tx.queryOne<{ policy_revision: number }>(
    'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [row.user_id, row.app_id],
  );
  if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('APPROVAL_STALE');
  const approval = await tx.queryOne<{
    tool_call_id: string;
    provider_call_id: string;
    operation_hash: string;
    status: string;
    version: number;
    policy_revision: number;
    input_revision: number;
    expires_at: number;
    requested_by_runtime_id: string;
  }>(
    `SELECT a.tool_call_id, t.provider_call_id, a.operation_hash, a.status, a.version,
            a.policy_revision, a.input_revision, a.expires_at, a.requested_by_runtime_id
     FROM agent_approvals a
     JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
     WHERE a.id = ? AND a.user_id = ? AND a.app_id = ? AND a.run_id = ?`,
    [command.approvalId, row.user_id, row.app_id, row.id],
  );
  if (
    !approval ||
    approval.status !== 'requested' ||
    approval.version !== command.expectedApprovalVersion ||
    approval.operation_hash !== command.operationHash ||
    approval.policy_revision !== command.expectedPolicyRevision ||
    approval.input_revision !== command.expectedInputRevision ||
    approval.expires_at <= command.now
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
    `UPDATE agent_approvals SET status = ?, decided_by_user_id = ?, decided_at = ?, version = version + 1
     WHERE id = ? AND status = 'requested' AND version = ? AND expires_at > ?`,
    [
      command.decision,
      command.decidedByUserId,
      command.now,
      command.approvalId,
      command.expectedApprovalVersion,
      command.now,
    ],
  );
  if (changed.changes !== 1) throw new Error('APPROVAL_STALE');
  const toolStatus = command.decision === 'approved' ? 'ready' : 'cancelled';
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = ?, version = version + 1,
       completed_at = CASE WHEN ? = 'cancelled' THEN ? ELSE completed_at END
     WHERE id = ? AND run_id = ? AND status = 'awaiting_approval' AND operation_hash = ?`,
    [toolStatus, toolStatus, command.now, approval.tool_call_id, row.id, command.operationHash],
  );
  if (toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'runnable', updated_at = ?
     WHERE id = ? AND run_id = ? AND schedule_state = 'waiting_approval'`,
    [command.now, approval.requested_by_runtime_id, row.id],
  );
  let ledgerCursor = 0;
  if (command.decision === 'denied') {
    await tx.execute(
      `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
       WHERE id = (SELECT step_id FROM agent_tool_calls WHERE id = ?) AND run_id = ? AND status = 'created'`,
      [command.now, approval.tool_call_id, row.id],
    );
    ledgerCursor = await appendLedger(
      tx,
      row,
      [
        {
          id: randomUUID(),
          runId: row.id,
          kind: 'tool_result',
          payload: {
            toolCallId: approval.provider_call_id,
            text: JSON.stringify({
              ok: false,
              outcome: 'confirmed',
              errorCode: 'APPROVAL_DENIED',
              summary: 'The user denied this remote mutation.',
            }),
          },
        },
      ],
      command.now,
    );
  }
  const events: DurableEventInput[] = [
    {
      type: command.decision === 'approved' ? 'approval.approved' : 'approval.denied',
      payload: {
        approvalId: command.approvalId,
        toolCallId: approval.tool_call_id,
        operationHash: command.operationHash,
      },
    },
    { type: 'run.status_changed', payload: { from: 'awaiting_approval', to: 'running' } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, { status: 'running' }, events.length, command.now);
  await tx.execute(
    `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ? WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  const commandCompleted = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 200, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = 'approval.resolve'
       AND idempotency_key = ? AND status = 'pending'`,
    [
      JSON.stringify({ runId: run.id, approvalId: command.approvalId }),
      command.now,
      row.user_id,
      row.app_id,
      command.idempotencyKey,
    ],
  );
  if (commandCompleted.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const expireToolApprovalsTransition = async (tx: RelationalDatabase, now: number): Promise<RunView[]> => {
  const expired = await tx.queryAll<{
    approval_id: string;
    run_id: string;
    user_id: number;
    app_id: string;
    tool_call_id: string;
    provider_call_id: string;
    step_id: string;
  }>(
    `SELECT a.id AS approval_id, a.run_id, a.user_id, a.app_id, a.tool_call_id,
            t.provider_call_id, t.step_id
     FROM agent_approvals a
     JOIN agent_runs r ON r.id = a.run_id AND r.user_id = a.user_id AND r.app_id = a.app_id
     JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
     WHERE a.status = 'requested' AND a.expires_at <= ? AND r.status = 'awaiting_approval'
     ORDER BY a.expires_at, a.id`,
    [now],
  );
  const resumed: RunView[] = [];
  for (const item of expired) {
    const row = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [item.run_id, item.user_id, item.app_id],
    );
    if (!row || row.status !== 'awaiting_approval') continue;
    const approvalChanged = await tx.execute(
      `UPDATE agent_approvals SET status = 'expired', decided_at = ?, version = version + 1
       WHERE id = ? AND status = 'requested' AND expires_at <= ?`,
      [now, item.approval_id, now],
    );
    if (approvalChanged.changes !== 1) continue;
    const toolChanged = await tx.execute(
      `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
       WHERE id = ? AND run_id = ? AND status = 'awaiting_approval'`,
      [now, item.tool_call_id, row.id],
    );
    const stepChanged = await tx.execute(
      `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
       WHERE id = ? AND run_id = ? AND status = 'created'`,
      [now, item.step_id, row.id],
    );
    if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('APPROVAL_STATE_INVALID');
    const ledgerCursor = await appendLedger(
      tx,
      row,
      [
        {
          id: randomUUID(),
          runId: row.id,
          kind: 'tool_result',
          payload: {
            toolCallId: item.provider_call_id,
            text: JSON.stringify({
              ok: false,
              outcome: 'confirmed',
              errorCode: 'APPROVAL_EXPIRED',
              summary: 'The approval request expired before it was consumed.',
            }),
          },
        },
      ],
      now,
    );
    const events: DurableEventInput[] = [
      {
        type: 'approval.expired',
        payload: { approvalId: item.approval_id, toolCallId: item.tool_call_id },
      },
      { type: 'run.status_changed', payload: { from: 'awaiting_approval', to: 'running' } },
    ];
    await appendEvents(tx, row, events, now);
    const updatedRow = await patchRun(tx, row, { status: 'running' }, events.length, now);
    await tx.execute(
      `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ?
       WHERE user_id = ? AND app_id = ?`,
      [now, row.user_id, row.app_id],
    );
    const run = mapRunRow(updatedRow);
    await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), now);
    void ledgerCursor;
    resumed.push(run);
  }
  return resumed;
};
