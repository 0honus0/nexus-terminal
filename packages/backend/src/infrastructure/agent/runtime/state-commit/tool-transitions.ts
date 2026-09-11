import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type {
  BeginMutationToolCommand,
  BeginReadToolCommand,
  CommitToolProposalCommand,
  CommitToolProposalResult,
  DurableEventInput,
  SettleMutationToolCommand,
  SettleReadToolCommand,
  StateCommitResult,
  SupersedeMutationToolCommand,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunStatus } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
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
            errorCode: 'APPROVAL_STALE',
            summary: command.reason,
          }),
        },
      },
    ],
    command.now,
  );
  const events: DurableEventInput[] = [
    {
      type: 'approval.superseded',
      payload: { approvalId: command.approvalId, toolCallId: command.toolCallId, reason: command.reason },
    },
    {
      type: 'tool.failed',
      payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId, errorCode: 'APPROVAL_STALE' },
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
  if (!tool || tool.status !== 'ready' || tool.risk === 'read' || tool.operation_hash !== command.operationHash) {
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
  const safeResult = JSON.parse(JSON.stringify(command.result)) as JsonValue;
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
          text: JSON.stringify(safeResult),
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

export const beginReadToolTransition = async (
  tx: RelationalDatabase,
  command: BeginReadToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const step = await tx.queryOne<{ status: string }>(
    'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
    [command.toolStepId, command.runId, command.runtimeId],
  );
  const tool = await tx.queryOne<{ status: string; version: number }>(
    'SELECT status, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
    [command.toolCallId, command.runId, command.toolStepId],
  );
  if (!step || step.status !== 'created' || !tool || tool.status !== 'proposed') throw new Error('TOOL_STATE_CONFLICT');
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'running' WHERE id = ? AND run_id = ? AND status = 'created'`,
    [command.toolStepId, command.runId],
  );
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'running', started_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
    [command.now, command.toolCallId, command.runId, tool.version],
  );
  if (stepChanged.changes !== 1 || toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const events: DurableEventInput[] = [
    { type: 'tool.started', payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const settleReadToolTransition = async (
  tx: RelationalDatabase,
  command: SettleReadToolCommand,
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
    [command.toolCallId, command.runId, command.toolStepId],
  );
  if (!tool || tool.status !== 'running') throw new Error('TOOL_STATE_CONFLICT');
  const safeResult = JSON.parse(JSON.stringify(command.result)) as JsonValue;
  const toolStatus = command.result.ok ? 'succeeded' : 'failed';
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = ?, result_json = ?, completed_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
    [toolStatus, JSON.stringify(safeResult), command.now, command.toolCallId, command.runId, tool.version],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = ?, completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.result.ok ? 'completed' : 'failed', command.now, command.toolStepId, command.runId],
  );
  if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: command.toolResultEntryId,
        runId: command.runId,
        kind: 'tool_result',
        payload: {
          toolCallId: command.providerCallId,
          text: JSON.stringify(safeResult),
        },
      },
    ],
    command.now,
  );
  const cancelling = row.status === 'cancelling';
  const events: DurableEventInput[] = [
    {
      type: command.result.ok ? 'tool.completed' : 'tool.failed',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        ok: command.result.ok,
        summary: command.result.summary,
        truncated: command.result.truncated,
        verification: command.result.verification.status,
      },
    },
    ...(cancelling
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

export const commitToolProposalTransition = async (
  tx: RelationalDatabase,
  command: CommitToolProposalCommand,
): Promise<CommitToolProposalResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (row.status !== 'running') throw new Error('RUN_NOT_SETTLEABLE');
  if (row.input_revision !== command.inspection.inputRevision) throw new Error('INPUT_REVISION_CONFLICT');
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
       cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      command.inputTokens ?? null,
      command.outputTokens ?? null,
      command.cachedInputTokens ?? null,
      command.costMicros ?? null,
      command.priceVersion ?? null,
      command.estimatedUsage ? 1 : 0,
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
  const toolStepId = randomUUID();
  const toolStepIndex = (previous?.max_index ?? 0) + 1;
  await tx.execute(
    `INSERT INTO agent_steps
      (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
       input_refs_json, output_refs_json, created_at, completed_at)
     VALUES (?, ?, ?, ?, 'tool', 'created', ?, '[]', '[]', ?, NULL)`,
    [toolStepId, command.runId, command.runtimeId, toolStepIndex, row.input_revision, command.now],
  );
  await tx.execute(
    `INSERT INTO agent_tool_calls
      (id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
       inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
       created_at, started_at, completed_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'proposed', NULL, ?, NULL, NULL, 1)`,
    [
      command.toolCallId,
      command.runId,
      command.runtimeId,
      toolStepId,
      command.providerCallId,
      command.toolName,
      command.toolVersion,
      JSON.stringify(command.inspection),
      command.inspection.operationHash,
      command.inspection.risk,
      command.now,
    ],
  );

  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: command.assistantEntryId,
        runId: command.runId,
        kind: 'assistant_message',
        payload: {
          text: command.assistantText,
          toolCalls: [
            {
              id: command.providerCallId,
              name: command.toolName,
              argumentsJson: command.argumentsJson,
            },
          ],
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
        finishReason: command.finishReason ?? 'tool_calls',
        inputTokens: command.inputTokens ?? null,
        outputTokens: command.outputTokens ?? null,
      },
    },
    {
      type: 'tool.proposed',
      payload: {
        toolCallId: command.toolCallId,
        providerCallId: command.providerCallId,
        toolStepId,
        toolName: command.toolName,
        operationHash: command.inspection.operationHash,
        risk: command.inspection.risk,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithDelta(row, {
    inputTokens: command.inputTokens,
    outputTokens: command.outputTokens,
    cachedInputTokens: command.cachedInputTokens,
    costMicros: command.costMicros,
    steps: 1,
  });
  const updatedRow = await patchRun(tx, row, { usage: mergedUsage }, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return {
    run,
    eventCursor: run.eventCursor,
    ledgerCursor,
    committedEvents,
    toolStepId,
    toolCallId: command.toolCallId,
  };
};
