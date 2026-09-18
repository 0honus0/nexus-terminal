import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import { projectToolResult } from '../../../../modules/agent/capabilities/tool-result-projection';
import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import type {
  BeginMutationToolCommand,
  BeginReadToolBatchCommand,
  CommitToolProposalBatchCommand,
  CommitToolProposalBatchResult,
  DurableEventInput,
  RefreshProposedToolCommand,
  RejectProposedToolCommand,
  SettleMutationToolCommand,
  SettleReadToolBatchCommand,
  SettleUserInputRequestToolCommand,
  StateCommitResult,
  SupersedeMutationToolCommand,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import { encodeModelProviderContinuation } from '../../../../modules/agent/ai/model-continuation';
import type { RunStatus } from '../../../../modules/agent/runtime/runs/run.types';
import { normalizeUserInputQuestions } from '../../../../modules/agent/runtime/runs/user-input-request';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import { evaluateLoopGuard } from './loop-guard';
import {
  allocateHostEvent,
  appendEvents,
  appendLedger,
  COUNTED_LIVE,
  patchRun,
  summaryPayload,
  updateAppLiveCount,
  usageWithDelta,
  usageWithProviderContext,
} from './transaction-primitives';

const modelToolResultJson = (row: RunRow, result: ToolResult): string =>
  JSON.stringify(projectToolResult(result, mapRunRow(row).budget.maxToolOutputBytes));

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
    ...(unknown
      ? [{ type: 'run.interrupted', payload: { reason: 'mutation_outcome_unknown', needsReconciliation: true } }]
      : row.status === 'cancelling'
        ? [
            { type: 'run.cancelled', payload: { reason: 'cancel_requested_during_tool' } },
            { type: 'run.status_changed', payload: { from: 'cancelling', to: 'cancelled' } },
          ]
        : []),
  ];
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

export const beginReadToolBatchTransition = async (
  tx: RelationalDatabase,
  command: BeginReadToolBatchCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (command.items.length < 1 || command.items.length > 64) throw new Error('VALIDATION_FAILED');
  if (
    new Set(command.items.map((item) => item.toolCallId)).size !== command.items.length ||
    new Set(command.items.map((item) => item.toolStepId)).size !== command.items.length
  ) {
    throw new Error('VALIDATION_FAILED');
  }

  for (const item of command.items) {
    const state = await tx.queryOne<{ step_status: string; tool_status: string; risk: string; version: number }>(
      `SELECT s.status AS step_status, t.status AS tool_status, t.risk, t.version
       FROM agent_steps s
       JOIN agent_tool_calls t ON t.step_id = s.id AND t.run_id = s.run_id
       WHERE s.id = ? AND s.run_id = ? AND s.agent_runtime_id = ? AND t.id = ?`,
      [item.toolStepId, command.runId, command.runtimeId, item.toolCallId],
    );
    if (
      !state ||
      state.step_status !== 'created' ||
      state.tool_status !== 'proposed' ||
      (state.risk !== 'read' && state.risk !== 'control')
    ) {
      throw new Error('TOOL_STATE_CONFLICT');
    }
    const stepChanged = await tx.execute(
      `UPDATE agent_steps SET status = 'running'
       WHERE id = ? AND run_id = ? AND status = 'created'`,
      [item.toolStepId, command.runId],
    );
    const toolChanged = await tx.execute(
      `UPDATE agent_tool_calls SET status = 'running', started_at = ?, version = version + 1
       WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
      [command.now, item.toolCallId, command.runId, state.version],
    );
    if (stepChanged.changes !== 1 || toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  }

  const events: DurableEventInput[] = command.items.map((item, batchIndex) => ({
    type: 'tool.started',
    payload: {
      toolCallId: item.toolCallId,
      toolStepId: item.toolStepId,
      batchIndex,
      batchSize: command.items.length,
    },
  }));
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const settleUserInputRequestToolTransition = async (
  tx: RelationalDatabase,
  command: SettleUserInputRequestToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (!command.result.ok || command.result.outcome !== 'confirmed') throw new Error('TOOL_STATE_CONFLICT');
  const questions = normalizeUserInputQuestions(command.questions);
  const runtime = await tx.queryOne<{ participant_id: string; schedule_state: string; status: string }>(
    `SELECT participant_id, schedule_state, status FROM agent_runtimes WHERE id = ? AND run_id = ?`,
    [command.runtimeId, command.runId],
  );
  if (!runtime || runtime.participant_id !== 'root') throw new Error('USER_INPUT_REQUEST_ROOT_ONLY');
  if (runtime.status !== 'running' || runtime.schedule_state !== 'executing')
    throw new Error('RUNTIME_NOT_SCHEDULABLE');
  const tool = await tx.queryOne<{
    status: string;
    provider_call_id: string;
    tool_name: string;
    risk: string;
    operation_hash: string;
    version: number;
  }>(
    `SELECT status, provider_call_id, tool_name, risk, operation_hash, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ? AND agent_runtime_id = ?`,
    [command.toolCallId, command.runId, command.toolStepId, command.runtimeId],
  );
  if (
    !tool ||
    tool.status !== 'running' ||
    tool.provider_call_id !== command.providerCallId ||
    tool.tool_name !== 'request_user_input' ||
    tool.risk !== 'control'
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM agent_input_requests WHERE run_id = ? AND status = 'requested' LIMIT 1`,
    [command.runId],
  );
  if (existing) throw new Error('USER_INPUT_REQUEST_ALREADY_PENDING');

  const guard = await evaluateLoopGuard(
    tx,
    row,
    command.runtimeId,
    null,
    [
      {
        toolName: 'request_user_input',
        risk: 'control',
        operationHash: tool.operation_hash,
        result: command.result,
      },
    ],
    command.now,
  );
  const currentRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!currentRow) throw new Error('NOT_FOUND');
  if (guard.paused ? currentRow.status !== 'awaiting_input' : currentRow.status !== 'running') {
    throw new Error('LOOP_GUARD_STATE_INVALID');
  }

  const resultJson = JSON.stringify(command.result);
  const modelResultJson = modelToolResultJson(currentRow, command.result);
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'succeeded', result_json = ?, completed_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
    [resultJson, command.now, command.toolCallId, command.runId, tool.version],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'completed', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.toolStepId, command.runId],
  );
  if (guard.paused) {
    const parkedRuntime = await tx.queryOne<{ status: string; schedule_state: string }>(
      `SELECT status, schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?`,
      [command.runtimeId, command.runId],
    );
    if (parkedRuntime?.status !== 'running' || parkedRuntime.schedule_state !== 'waiting_message') {
      throw new Error('LOOP_GUARD_STATE_INVALID');
    }
  } else {
    const runtimeChanged = await tx.execute(
      `UPDATE agent_runtimes SET schedule_state = 'waiting_message', updated_at = ?
       WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
      [command.now, command.runtimeId, command.runId],
    );
    if (runtimeChanged.changes !== 1) throw new Error('RUNTIME_NOT_SCHEDULABLE');
  }
  if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  await tx.execute(
    `INSERT INTO agent_input_requests
      (id, run_id, user_id, app_id, agent_runtime_id, tool_call_id, provider_call_id, questions_json,
       status, requested_at, answered_at, answer_entry_id, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, NULL, NULL, 1)`,
    [
      command.requestId,
      command.runId,
      currentRow.user_id,
      currentRow.app_id,
      command.runtimeId,
      command.toolCallId,
      command.providerCallId,
      JSON.stringify(questions),
      command.now,
    ],
  );
  const ledgerCursor = await appendLedger(
    tx,
    currentRow,
    [
      {
        id: command.toolResultEntryId,
        runId: currentRow.id,
        kind: 'tool_result',
        payload: { toolCallId: command.providerCallId, text: modelResultJson },
      },
    ],
    command.now,
  );
  const events: DurableEventInput[] = [
    {
      type: 'tool.completed',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        ok: true,
        summary: command.result.summary,
        truncated: command.result.truncated,
        verification: command.result.verification.status,
        batchIndex: 0,
        batchSize: 1,
      },
    },
    {
      type: 'input.requested',
      payload: {
        requestId: command.requestId,
        runtimeId: command.runtimeId,
        toolCallId: command.toolCallId,
        questionCount: questions.length,
      },
    },
    ...(guard.paused ? [] : [{ type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_input' } }]),
  ];
  const committedEvents = await appendEvents(tx, currentRow, events, command.now);
  const nextExecuting = guard.paused
    ? currentRow.executing_runtime_count
    : Math.max(0, currentRow.executing_runtime_count - 1);
  const activeDelta =
    !guard.paused && currentRow.executing_runtime_count <= 1 && currentRow.active_execution_started_at !== null
      ? Math.max(0, command.now - currentRow.active_execution_started_at)
      : 0;
  const mergedUsage = usageWithDelta(currentRow, { steps: 1 });
  const runChanged = await tx.execute(
    `UPDATE agent_runs SET status = 'awaiting_input', usage_json = ?,
       active_execution_seconds = active_execution_seconds + ?,
       active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
       executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = ?`,
    [
      JSON.stringify(mergedUsage),
      activeDelta,
      nextExecuting,
      nextExecuting,
      events.length,
      command.now,
      currentRow.id,
      currentRow.user_id,
      currentRow.app_id,
      currentRow.version,
      currentRow.status,
    ],
  );
  if (runChanged.changes !== 1) throw new Error('STATE_CONFLICT');
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [currentRow.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const settleReadToolBatchTransition = async (
  tx: RelationalDatabase,
  command: SettleReadToolBatchCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || !['running', 'cancelling'].includes(row.status)) {
    throw new Error('STATE_CONFLICT');
  }
  if (command.items.length < 1 || command.items.length > 64) throw new Error('VALIDATION_FAILED');
  if (
    new Set(command.items.map((item) => item.toolCallId)).size !== command.items.length ||
    new Set(command.items.map((item) => item.toolStepId)).size !== command.items.length ||
    new Set(command.items.map((item) => item.providerCallId)).size !== command.items.length
  ) {
    throw new Error('VALIDATION_FAILED');
  }

  const ledgerAppends = [];
  const events: DurableEventInput[] = [];
  for (const [batchIndex, item] of command.items.entries()) {
    const tool = await tx.queryOne<{ status: string; provider_call_id: string; version: number }>(
      `SELECT status, provider_call_id, version FROM agent_tool_calls
       WHERE id = ? AND run_id = ? AND step_id = ? AND agent_runtime_id = ?`,
      [item.toolCallId, row.id, item.toolStepId, command.runtimeId],
    );
    if (!tool || tool.status !== 'running' || tool.provider_call_id !== item.providerCallId) {
      throw new Error('TOOL_STATE_CONFLICT');
    }
    const safeResult = JSON.parse(JSON.stringify(item.result)) as ToolResult;
    const toolStatus = item.result.ok ? 'succeeded' : 'failed';
    const toolChanged = await tx.execute(
      `UPDATE agent_tool_calls SET status = ?, result_json = ?, completed_at = ?, version = version + 1
       WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
      [toolStatus, JSON.stringify(safeResult), command.now, item.toolCallId, row.id, tool.version],
    );
    const stepChanged = await tx.execute(
      `UPDATE agent_steps SET status = ?, completed_at = ?
       WHERE id = ? AND run_id = ? AND status = 'running'`,
      [item.result.ok ? 'completed' : 'failed', command.now, item.toolStepId, row.id],
    );
    if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
    ledgerAppends.push({
      id: item.toolResultEntryId,
      runId: row.id,
      kind: 'tool_result' as const,
      payload: { toolCallId: item.providerCallId, text: modelToolResultJson(row, safeResult) },
    });
    events.push({
      type: item.result.ok ? 'tool.completed' : 'tool.failed',
      payload: {
        toolCallId: item.toolCallId,
        toolStepId: item.toolStepId,
        ok: item.result.ok,
        summary: item.result.summary,
        truncated: item.result.truncated,
        verification: item.result.verification.status,
        batchIndex,
        batchSize: command.items.length,
      },
    });
  }

  const ledgerCursor = await appendLedger(tx, row, ledgerAppends, command.now);
  const cancelling = row.status === 'cancelling';
  if (cancelling) {
    events.push(
      { type: 'run.cancelled', payload: { reason: 'cancel_requested_during_tool_batch' } },
      { type: 'run.status_changed', payload: { from: 'cancelling', to: 'cancelled' } },
    );
  }
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithDelta(row, { steps: command.items.length });
  const updatedRow = await patchRun(
    tx,
    row,
    { usage: mergedUsage, ...(cancelling ? { status: 'cancelled', completedAt: command.now } : {}) },
    events.length,
    command.now,
  );
  if (cancelling) {
    await tx.execute(
      `UPDATE agent_runtimes SET status = 'stopped', updated_at = ?
       WHERE run_id = ? AND status IN ('created','running','stopping')`,
      [command.now, row.id],
    );
    if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
  }
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const refreshProposedToolTransition = async (
  tx: RelationalDatabase,
  command: RefreshProposedToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.inspection.inputRevision) throw new Error('INPUT_REVISION_CONFLICT');
  const tool = await tx.queryOne<{ status: string; tool_name: string; tool_version: string; version: number }>(
    `SELECT status, tool_name, tool_version, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ?`,
    [command.toolCallId, row.id, command.toolStepId],
  );
  if (
    !tool ||
    tool.status !== 'proposed' ||
    tool.tool_name !== command.inspection.toolName ||
    tool.tool_version !== command.inspection.toolVersion
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const changed = await tx.execute(
    `UPDATE agent_tool_calls
     SET inspection_json = ?, operation_hash = ?, risk = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
    [
      JSON.stringify(command.inspection),
      command.inspection.operationHash,
      command.inspection.risk,
      command.toolCallId,
      row.id,
      tool.version,
    ],
  );
  if (changed.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const events: DurableEventInput[] = [
    {
      type: 'tool.reinspected',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        operationHash: command.inspection.operationHash,
        risk: command.inspection.risk,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const rejectProposedToolTransition = async (
  tx: RelationalDatabase,
  command: RejectProposedToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (command.result.outcome !== 'confirmed' || command.result.ok) throw new Error('TOOL_RESULT_INVALID');
  const tool = await tx.queryOne<{ status: string; provider_call_id: string; version: number }>(
    `SELECT status, provider_call_id, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ?`,
    [command.toolCallId, row.id, command.toolStepId],
  );
  if (!tool || tool.status !== 'proposed' || tool.provider_call_id !== command.providerCallId) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const safeResult = JSON.parse(JSON.stringify(command.result)) as ToolResult;
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'failed', result_json = ?, completed_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
    [JSON.stringify(safeResult), command.now, command.toolCallId, row.id, tool.version],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'failed', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'created'`,
    [command.now, command.toolStepId, row.id],
  );
  if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: randomUUID(),
        runId: row.id,
        kind: 'tool_result',
        payload: { toolCallId: command.providerCallId, text: modelToolResultJson(row, safeResult) },
      },
    ],
    command.now,
  );
  const events: DurableEventInput[] = [
    {
      type: 'tool.failed',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        errorCode: command.result.errorCode ?? 'TOOL_REJECTED',
        summary: command.result.summary,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const commitToolProposalBatchTransition = async (
  tx: RelationalDatabase,
  command: CommitToolProposalBatchCommand,
): Promise<CommitToolProposalBatchResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (row.status !== 'running') throw new Error('RUN_NOT_SETTLEABLE');
  if (command.items.length < 1 || command.items.length > 64) throw new Error('VALIDATION_FAILED');
  if (new Set(command.items.map((item) => item.providerCallId)).size !== command.items.length) {
    throw new Error('MODEL_TOOL_CALL_INVALID');
  }
  if (new Set(command.items.map((item) => item.toolCallId)).size !== command.items.length) {
    throw new Error('MODEL_TOOL_CALL_INVALID');
  }
  if (command.items.some((item) => item.inspection.inputRevision !== row.input_revision)) {
    throw new Error('INPUT_REVISION_CONFLICT');
  }
  const step = await tx.queryOne<{ status: string }>(
    'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
    [command.modelStepId, command.runId, command.runtimeId],
  );
  if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.modelStepId, command.runId],
  );
  if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

  await tx.execute(
    `UPDATE agent_model_attempts SET status = 'completed', input_tokens = ?, output_tokens = ?,
       cached_input_tokens = ?, estimated = ?, continuation_json = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      command.inputTokens ?? null,
      command.outputTokens ?? null,
      command.cachedInputTokens ?? null,
      command.estimatedUsage ? 1 : 0,
      command.providerContinuation ? encodeModelProviderContinuation(command.providerContinuation) : null,
      command.now,
      command.attemptId,
    ],
  );
  await tx.execute(
    `UPDATE agent_steps SET status = 'completed', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.modelStepId, command.runId],
  );

  const previous = await tx.queryOne<{ max_index: number | null }>(
    'SELECT MAX(step_index) AS max_index FROM agent_steps WHERE run_id = ?',
    [command.runId],
  );
  const resultItems: CommitToolProposalBatchResult['items'] = [];
  const firstToolStepIndex = (previous?.max_index ?? 0) + 1;
  for (const [index, item] of command.items.entries()) {
    const toolStepId = randomUUID();
    await tx.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'tool', ?, ?, '[]', '[]', ?, ?)`,
      [
        toolStepId,
        command.runId,
        command.runtimeId,
        firstToolStepIndex + index,
        'created',
        row.input_revision,
        command.now,
        null,
      ],
    );
    await tx.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
         created_at, started_at, completed_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, 1)`,
      [
        item.toolCallId,
        command.runId,
        command.runtimeId,
        toolStepId,
        command.modelStepId,
        index,
        command.items.length,
        item.providerCallId,
        item.toolName,
        item.toolVersion,
        JSON.stringify(item.inspection),
        item.inspection.operationHash,
        item.inspection.risk,
        'proposed',
        null,
        command.now,
        null,
      ],
    );
    resultItems.push({ providerCallId: item.providerCallId, toolCallId: item.toolCallId, toolStepId });
  }

  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: command.assistantEntryId,
        runId: command.runId,
        kind: 'assistant_message',
        payload: {
          modelStepId: command.modelStepId,
          text: command.assistantText,
          toolCalls: command.items.map((item) => ({
            id: item.providerCallId,
            name: item.modelToolName ?? item.toolName,
            argumentsJson: item.modelArgumentsJson ?? item.argumentsJson,
          })),
        },
      },
    ],
    command.now,
  );
  const events: DurableEventInput[] = [
    {
      type: 'model.completed',
      payload: {
        stepId: command.modelStepId,
        attemptId: command.attemptId,
        finishReason: command.finishReason ?? 'tool-calls',
        inputTokens: command.inputTokens ?? null,
        outputTokens: command.outputTokens ?? null,
      },
    },
  ];
  for (const [index, item] of command.items.entries()) {
    const resultItem = resultItems[index]!;
    events.push({
      type: 'tool.proposed',
      payload: {
        toolCallId: item.toolCallId,
        providerCallId: item.providerCallId,
        toolStepId: resultItem.toolStepId,
        toolName: item.toolName,
        operationHash: item.inspection.operationHash,
        risk: item.inspection.risk,
        batchIndex: index,
        batchSize: command.items.length,
      },
    });
  }
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithProviderContext(
    usageWithDelta(row, {
      inputTokens: command.inputTokens,
      outputTokens: command.outputTokens,
      cachedInputTokens: command.cachedInputTokens,
      steps: 1,
    }),
    command.inputTokens,
    command.estimatedUsage,
    command.now,
  );
  const updatedRow = await patchRun(tx, row, { usage: mergedUsage }, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return {
    run,
    eventCursor: run.eventCursor,
    ledgerCursor,
    committedEvents,
    items: resultItems,
  };
};
