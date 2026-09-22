import type { JsonValue } from '../../../../modules/agent/agent.types';
import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import type {
  BeginReadToolBatchCommand,
  DurableEventInput,
  ParkMcpInputRequiredToolCommand,
  SettleReadToolBatchCommand,
  SettleUserInputRequestToolCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import { normalizeUserInputQuestions } from '../../../../modules/agent/runtime/runs/user-input-request';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS } from '../../repositories/sqlite-run.mapper';
import type { RunRow } from '../../repositories/sqlite-run.mapper';
import { evaluateLoopGuard } from './loop-guard';
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

  await linkVerifiedToolEvidence(tx, currentRow, command.result, command.now);
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
  ];
  if (!guard.paused) {
    events.push({ type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_input' } });
  }
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

export const parkMcpInputRequiredToolTransition = async (
  tx: RelationalDatabase,
  command: ParkMcpInputRequiredToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const questions = normalizeUserInputQuestions(command.questions);
  const continuation = JSON.parse(JSON.stringify(command.continuation)) as JsonValue;
  const runtime = await tx.queryOne<{ participant_id: string; schedule_state: string; status: string }>(
    `SELECT participant_id, schedule_state, status FROM agent_runtimes WHERE id = ? AND run_id = ?`,
    [command.runtimeId, command.runId],
  );
  if (!runtime || runtime.participant_id !== 'root') throw new Error('MCP_INPUT_REQUIRED_ROOT_ONLY');
  if (runtime.status !== 'running' || runtime.schedule_state !== 'executing') {
    throw new Error('RUNTIME_NOT_SCHEDULABLE');
  }
  const tool = await tx.queryOne<{ status: string; provider_call_id: string; risk: string; version: number }>(
    `SELECT status, provider_call_id, risk, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ? AND agent_runtime_id = ?`,
    [command.toolCallId, command.runId, command.toolStepId, command.runtimeId],
  );
  if (
    !tool ||
    tool.status !== 'running' ||
    tool.provider_call_id !== command.providerCallId ||
    (tool.risk !== 'read' && tool.risk !== 'control')
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM agent_input_requests WHERE run_id = ? AND status = 'requested' LIMIT 1`,
    [command.runId],
  );
  if (existing) throw new Error('USER_INPUT_REQUEST_ALREADY_PENDING');
  const previousForTool = await tx.queryOne<{ id: string; status: string; version: number }>(
    `SELECT id, status, version FROM agent_input_requests WHERE run_id = ? AND tool_call_id = ? LIMIT 1`,
    [command.runId, command.toolCallId],
  );
  if (previousForTool && previousForTool.status !== 'answered') {
    throw new Error('USER_INPUT_REQUEST_STATE_CONFLICT');
  }
  const requestId = previousForTool?.id ?? command.requestId;

  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls
     SET status = 'proposed', started_at = NULL, result_json = NULL, completed_at = NULL, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
    [command.toolCallId, command.runId, tool.version],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'created', completed_at = NULL
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.toolStepId, command.runId],
  );
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'waiting_message', updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
    [command.now, command.runtimeId, command.runId],
  );
  if (toolChanged.changes !== 1 || stepChanged.changes !== 1 || runtimeChanged.changes !== 1) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  if (previousForTool) {
    const requestChanged = await tx.execute(
      `UPDATE agent_input_requests
       SET questions_json = ?, continuation_json = ?, status = 'requested', requested_at = ?,
           answered_at = NULL, answer_entry_id = NULL, version = version + 1
       WHERE id = ? AND run_id = ? AND tool_call_id = ? AND status = 'answered' AND version = ?`,
      [
        JSON.stringify(questions),
        JSON.stringify(continuation),
        command.now,
        previousForTool.id,
        command.runId,
        command.toolCallId,
        previousForTool.version,
      ],
    );
    if (requestChanged.changes !== 1) throw new Error('USER_INPUT_REQUEST_STATE_CONFLICT');
  } else {
    await tx.execute(
      `INSERT INTO agent_input_requests
        (id, run_id, user_id, app_id, agent_runtime_id, tool_call_id, provider_call_id, questions_json,
         continuation_json, status, requested_at, answered_at, answer_entry_id, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, NULL, NULL, 1)`,
      [
        requestId,
        command.runId,
        row.user_id,
        row.app_id,
        command.runtimeId,
        command.toolCallId,
        command.providerCallId,
        JSON.stringify(questions),
        JSON.stringify(continuation),
        command.now,
      ],
    );
  }
  const events: DurableEventInput[] = [
    {
      type: 'input.requested',
      payload: {
        requestId,
        runtimeId: command.runtimeId,
        toolCallId: command.toolCallId,
        questionCount: questions.length,
        source: 'mcp_input_required',
      },
    },
    { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_input' } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const activeDelta =
    row.executing_runtime_count <= 1 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const mergedUsage = usageWithDelta(row, { steps: 1 });
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET status = 'awaiting_input', usage_json = ?,
       active_execution_seconds = active_execution_seconds + ?,
       active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
       executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'running'`,
    [
      JSON.stringify(mergedUsage),
      activeDelta,
      nextExecuting,
      nextExecuting,
      events.length,
      command.now,
      row.id,
      row.user_id,
      row.app_id,
      row.version,
    ],
  );
  if (changedRun.changes !== 1) throw new Error('STATE_CONFLICT');
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
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
    await linkVerifiedToolEvidence(tx, row, safeResult, command.now);
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
