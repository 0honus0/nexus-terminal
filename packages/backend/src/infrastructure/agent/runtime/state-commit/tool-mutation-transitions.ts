import { randomUUID } from 'node:crypto';
import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import type {
  BeginMutationToolCommand,
  DurableEventInput,
  SettleMutationToolCommand,
  StateCommitResult,
  SupersedeMutationToolCommand,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunStatus } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS } from '../../repositories/sqlite-run.mapper';
import type { RunRow } from '../../repositories/sqlite-run.mapper';
import { linkVerifiedToolEvidence } from './artifact-evidence';
import {
  allocateHostEvent,
  appendEvents,
  appendLedger,
  COUNTED_LIVE,
  patchRun,
  summaryPayload,
  updateAppLiveCount,
  usageWithDelta,
} from './transaction-primitives';
import { modelToolResultJson } from './tool-transition-result';

export const supersedeMutationToolTransition = async (
  tx: RelationalDatabase,
  command: SupersedeMutationToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const approval = await tx.queryOne<{ status: string; consumed_at: number | null; tool_call_id: string }>(
    `SELECT status, consumed_at, tool_call_id FROM agent_approvals
     WHERE id = ? AND user_id = ? AND app_id = ? AND run_id = ?`,
    [command.approvalId, row.user_id, row.app_id, row.id],
  );
  const tool = await tx.queryOne<{ status: string; provider_call_id: string }>(
    `SELECT status, provider_call_id FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ?`,
    [command.toolCallId, row.id, command.toolStepId],
  );
  if (
    !approval ||
    approval.status !== 'approved' ||
    approval.consumed_at !== null ||
    approval.tool_call_id !== command.toolCallId ||
    !tool ||
    tool.status !== 'ready'
  ) {
    throw new Error('APPROVAL_STALE');
  }
  const approvalChanged = await tx.execute(
    `UPDATE agent_approvals SET status = 'superseded', decided_at = ?, version = version + 1
     WHERE id = ? AND status = 'approved' AND consumed_at IS NULL`,
    [command.now, command.approvalId],
  );
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'ready'`,
    [command.now, command.toolCallId, row.id],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'created'`,
    [command.now, command.toolStepId, row.id],
  );
  if (approvalChanged.changes !== 1 || toolChanged.changes !== 1 || stepChanged.changes !== 1) {
    throw new Error('APPROVAL_STALE');
  }
  const failureCode = command.errorCode;
  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: randomUUID(),
        runId: row.id,
        kind: 'tool_result',
        payload: {
          toolCallId: tool.provider_call_id,
          text: JSON.stringify({
            ok: false,
            outcome: 'confirmed',
            errorCode: failureCode,
            summary: command.reason,
            ...(command.details === undefined ? {} : { data: { failure: command.details } }),
          }),
        },
      },
    ],
    command.now,
  );
  const events: DurableEventInput[] = [
    {
      type: 'approval.superseded',
      payload: {
        approvalId: command.approvalId,
        toolCallId: command.toolCallId,
        reason: command.reason,
        errorCode: failureCode,
      },
    },
    {
      type: 'tool.failed',
      payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId, errorCode: failureCode },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const beginMutationToolTransition = async (
  tx: RelationalDatabase,
  command: BeginMutationToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.expectedInputRevision) throw new Error('APPROVAL_STALE');
  const app = await tx.queryOne<{ policy_revision: number }>(
    'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [row.user_id, row.app_id],
  );
  if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('APPROVAL_STALE');
  const approval = await tx.queryOne<{
    status: string;
    consumed_at: number | null;
    operation_hash: string;
    expires_at: number;
    version: number;
  }>(
    `SELECT status, consumed_at, operation_hash, expires_at, version FROM agent_approvals
     WHERE id = ? AND user_id = ? AND app_id = ? AND run_id = ? AND tool_call_id = ?`,
    [command.approvalId, row.user_id, row.app_id, row.id, command.toolCallId],
  );
  if (
    !approval ||
    approval.status !== 'approved' ||
    approval.consumed_at !== null ||
    approval.operation_hash !== command.operationHash ||
    approval.expires_at <= command.now
  )
    throw new Error('APPROVAL_STALE');
  const tool = await tx.queryOne<{ status: string; operation_hash: string; risk: string; version: number }>(
    'SELECT status, operation_hash, risk, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
    [command.toolCallId, row.id, command.toolStepId],
  );
  if (
    !tool ||
    tool.status !== 'ready' ||
    (tool.risk !== 'mutate' && tool.risk !== 'destructive') ||
    tool.operation_hash !== command.operationHash
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const approvalChanged = await tx.execute(
    `UPDATE agent_approvals SET consumed_at = ?, version = version + 1
     WHERE id = ? AND status = 'approved' AND consumed_at IS NULL AND version = ? AND expires_at > ?`,
    [command.now, command.approvalId, approval.version, command.now],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'running' WHERE id = ? AND run_id = ? AND status = 'created'`,
    [command.toolStepId, row.id],
  );
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'running', started_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'ready' AND version = ?`,
    [command.now, command.toolCallId, row.id, tool.version],
  );
  if (approvalChanged.changes !== 1 || stepChanged.changes !== 1 || toolChanged.changes !== 1) {
    throw new Error('APPROVAL_STALE');
  }
  const events: DurableEventInput[] = [
    { type: 'approval.consumed', payload: { approvalId: command.approvalId, toolCallId: command.toolCallId } },
    { type: 'tool.started', payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET active_execution_started_at = CASE
         WHEN executing_runtime_count = 0 THEN ? ELSE active_execution_started_at END,
       next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'running'`,
    [command.now, events.length, command.now, row.id, row.user_id, row.app_id, row.version],
  );
  if (changedRun.changes !== 1) throw new Error('STATE_CONFLICT');
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const settleMutationToolTransition = async (
  tx: RelationalDatabase,
  command: SettleMutationToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || !['running', 'cancelling'].includes(row.status)) {
    throw new Error('STATE_CONFLICT');
  }
  const tool = await tx.queryOne<{ status: string; version: number }>(
    'SELECT status, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
    [command.toolCallId, row.id, command.toolStepId],
  );
  if (!tool || tool.status !== 'running') throw new Error('TOOL_STATE_CONFLICT');
  const unknown = command.result.outcome === 'unknown' || command.needsReconciliation === true;
  const toolStatus = unknown ? 'reconciling' : command.result.ok ? 'succeeded' : 'failed';
  const safeResult = JSON.parse(JSON.stringify(command.result)) as ToolResult;
  await linkVerifiedToolEvidence(tx, row, safeResult, command.now);
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = ?, result_json = ?, completed_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
    [toolStatus, JSON.stringify(safeResult), command.now, command.toolCallId, row.id, tool.version],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = ?, completed_at = ? WHERE id = ? AND run_id = ? AND status = 'running'`,
    [unknown ? 'failed' : command.result.ok ? 'completed' : 'failed', command.now, command.toolStepId, row.id],
  );
  if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: command.toolResultEntryId,
        runId: row.id,
        kind: 'tool_result',
        payload: {
          toolCallId: command.providerCallId,
          text: modelToolResultJson(row, safeResult),
        },
      },
    ],
    command.now,
  );
  const nextStatus: RunStatus = unknown ? 'interrupted' : row.status === 'cancelling' ? 'cancelled' : 'running';
  const terminal = nextStatus === 'interrupted' || nextStatus === 'cancelled';
  const events: DurableEventInput[] = [
    {
      type: unknown ? 'tool.reconciliation_required' : command.result.ok ? 'tool.completed' : 'tool.failed',
      payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId, outcome: command.result.outcome },
    },
  ];
  if (unknown) {
    events.push({
      type: 'run.interrupted',
      payload: { reason: 'mutation_outcome_unknown', needsReconciliation: true },
    });
  } else if (row.status === 'cancelling') {
    events.push(
      { type: 'run.cancelled', payload: { reason: 'cancel_requested_during_tool' } },
      { type: 'run.status_changed', payload: { from: 'cancelling', to: 'cancelled' } },
    );
  }
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithDelta(row, { steps: 1 });
  const updatedRow = await patchRun(
    tx,
    row,
    {
      status: nextStatus,
      usage: mergedUsage,
      needsReconciliation: unknown,
      ...(terminal ? { completedAt: command.now } : {}),
    },
    events.length,
    command.now,
  );
  if (terminal) {
    await tx.execute(
      `UPDATE agent_runtimes SET status = ?, updated_at = ?
       WHERE run_id = ? AND status IN ('created','running','stopping')`,
      [unknown ? 'failed' : 'stopped', command.now, row.id],
    );
    if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
  }
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};
