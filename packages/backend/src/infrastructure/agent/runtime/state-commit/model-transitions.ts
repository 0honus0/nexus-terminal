import { randomUUID } from 'node:crypto';
import type {
  BeginModelStepCommand,
  BeginModelStepResult,
  DurableEventInput,
  ParkModelStepCommand,
  PauseModelStepForBudgetCommand,
  RetryModelStepCommand,
  RetryModelStepResult,
  SettleModelStepCommand,
  StateCommitResult,
  SupersedeModelStepCommand,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import {
  allocateHostEvent,
  appendEvents,
  appendLedger,
  patchRun,
  summaryPayload,
  updateAppLiveCount,
  usageWithDelta,
} from './transaction-primitives';

export const beginModelStepTransition = async (
  tx: RelationalDatabase,
  command: BeginModelStepCommand,
): Promise<BeginModelStepResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.inputWatermark) throw new Error('INPUT_REVISION_CONFLICT');
  if (!['created', 'running'].includes(row.status)) throw new Error('RUN_NOT_SCHEDULABLE');
  const firstStep = row.status === 'created';
  const app = await tx.queryOne<{ desired_state: string }>(
    'SELECT desired_state FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [row.user_id, row.app_id],
  );
  if (!app || app.desired_state !== 'enabled') throw new Error('AGENT_APP_DISABLED');
  const runtime = await tx.queryOne<{ status: string; schedule_state: string }>(
    'SELECT status, schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
    [command.runtimeId, command.runId],
  );
  if (
    !runtime ||
    !['created', 'running'].includes(runtime.status) ||
    !['queued', 'runnable'].includes(runtime.schedule_state)
  ) {
    throw new Error('RUNTIME_NOT_SCHEDULABLE');
  }
  const previous = await tx.queryOne<{ max_index: number | null }>(
    'SELECT MAX(step_index) AS max_index FROM agent_steps WHERE run_id = ?',
    [command.runId],
  );
  const stepIndex = (previous?.max_index ?? 0) + 1;
  const stepId = randomUUID();
  const attemptId = randomUUID();
  await tx.execute(
    `INSERT INTO agent_steps
      (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
       input_refs_json, output_refs_json, created_at, completed_at)
     VALUES (?, ?, ?, ?, 'model', 'running', ?, '[]', '[]', ?, NULL)`,
    [stepId, command.runId, command.runtimeId, stepIndex, command.inputWatermark, command.now],
  );
  await tx.execute(
    `INSERT INTO agent_model_attempts
      (id, step_id, attempt_index, status, reserved_tokens, input_tokens, output_tokens,
       cached_input_tokens, cost_micros, price_version, estimated, error_code, created_at, completed_at)
     VALUES (?, ?, 1, 'streaming', ?, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
    [attemptId, stepId, command.reservedTokens, command.now],
  );
  await tx.execute(
    `UPDATE agent_runtimes SET status = 'running', schedule_state = 'executing', updated_at = ?
     WHERE id = ? AND run_id = ? AND status IN ('created','running')`,
    [command.now, command.runtimeId, command.runId],
  );
  const events: DurableEventInput[] = [
    ...(firstStep ? [{ type: 'run.status_changed', payload: { from: 'created', to: 'running' } } as const] : []),
    { type: 'model.started', payload: { stepId, attemptId, attemptIndex: 1 } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updated = await tx.execute(
    `UPDATE agent_runs SET
       status = 'running', goal_status = 'in_progress', started_at = COALESCE(started_at, ?),
       active_execution_started_at = CASE WHEN executing_runtime_count = 0 THEN ? ELSE active_execution_started_at END,
       executing_runtime_count = executing_runtime_count + 1,
       next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [
      command.now,
      command.now,
      events.length,
      command.now,
      command.runId,
      command.scope.userId,
      command.scope.appId,
      row.version,
    ],
  );
  if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
  if (firstStep) await updateAppLiveCount(tx, row.user_id, row.app_id, 1, command.now);
  const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [command.runId]);
  if (!updatedRow) throw new Error('NOT_FOUND');
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, stepId, attemptId, attemptIndex: 1, committedEvents };
};

export const parkModelStepTransition = async (
  tx: RelationalDatabase,
  command: ParkModelStepCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const step = await tx.queryOne<{ status: string }>(
    `SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'model'`,
    [command.stepId, command.runId, command.runtimeId],
  );
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.stepId, command.runId],
  );
  if (!step || step.status !== 'running' || !attempt || attempt.status !== 'streaming') {
    throw new Error('ATTEMPT_STATE_CONFLICT');
  }
  await tx.execute(
    `UPDATE agent_model_attempts SET status = 'completed', input_tokens = ?, output_tokens = ?,
     cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?, error_code = NULL, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      command.inputTokens,
      command.outputTokens,
      command.cachedInputTokens,
      command.costMicros,
      command.priceVersion,
      command.estimatedUsage ? 1 : 0,
      command.now,
      command.attemptId,
    ],
  );
  await tx.execute(
    `UPDATE agent_steps SET status = 'completed', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.stepId, command.runId],
  );
  const scheduleState = command.reason === 'waiting_subagents' ? 'joining' : 'waiting_message';
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET status = 'running', schedule_state = ?, updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [scheduleState, command.now, command.runtimeId, command.runId],
  );
  if (runtimeChanged.changes !== 1) throw new Error('RUNTIME_NOT_SCHEDULABLE');
  let ledgerCursor = 0;
  if (command.assistantText !== undefined && command.assistantEntryId) {
    ledgerCursor = await appendLedger(
      tx,
      row,
      [
        {
          id: command.assistantEntryId,
          runId: command.runId,
          kind: 'assistant_message',
          payload: { text: command.assistantText },
        },
      ],
      command.now,
    );
  }
  const events: DurableEventInput[] = [
    {
      type: 'model.completed',
      payload: {
        stepId: command.stepId,
        attemptId: command.attemptId,
        runtimeId: command.runtimeId,
        finishReason: command.finishReason,
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
      },
    },
    {
      type: command.reason === 'waiting_subagents' ? 'subagent.join_waiting' : 'subagent.message_waiting',
      payload: { runtimeId: command.runtimeId },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const activeDelta =
    row.executing_runtime_count <= 1 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
     active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
     executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'running'`,
    [
      JSON.stringify(
        usageWithDelta(row, {
          inputTokens: command.inputTokens,
          outputTokens: command.outputTokens,
          cachedInputTokens: command.cachedInputTokens,
          costMicros: command.costMicros,
          steps: 1,
        }),
      ),
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
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const retryModelStepTransition = async (
  tx: RelationalDatabase,
  command: RetryModelStepCommand,
): Promise<RetryModelStepResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const step = await tx.queryOne<{ status: string }>(
    'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
    [command.stepId, command.runId, command.runtimeId],
  );
  if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
  const attempt = await tx.queryOne<{ status: string; attempt_index: number }>(
    `SELECT a.status, a.attempt_index FROM agent_model_attempts a
     JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.stepId, command.runId],
  );
  if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

  const closed = await tx.execute(
    `UPDATE agent_model_attempts SET status = 'failed', input_tokens = ?, output_tokens = ?,
       cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?, error_code = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      command.inputTokens ?? null,
      command.outputTokens ?? null,
      command.cachedInputTokens ?? null,
      command.costMicros ?? null,
      command.priceVersion ?? null,
      command.estimatedUsage ? 1 : 0,
      command.errorCode,
      command.now,
      command.attemptId,
    ],
  );
  if (closed.changes !== 1) throw new Error('ATTEMPT_STATE_CONFLICT');

  const attemptIndex = attempt.attempt_index + 1;
  const attemptId = randomUUID();
  await tx.execute(
    `INSERT INTO agent_model_attempts
      (id, step_id, attempt_index, status, reserved_tokens, input_tokens, output_tokens,
       cached_input_tokens, cost_micros, price_version, estimated, error_code, created_at, completed_at)
     VALUES (?, ?, ?, 'streaming', ?, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
    [attemptId, command.stepId, attemptIndex, command.reservedTokens, command.now],
  );
  const events: DurableEventInput[] = [
    {
      type: 'model.retrying',
      payload: {
        stepId: command.stepId,
        previousAttemptId: command.attemptId,
        attemptId,
        attemptIndex,
        errorCode: command.errorCode,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithDelta(row, {
    inputTokens: command.inputTokens,
    outputTokens: command.outputTokens,
    cachedInputTokens: command.cachedInputTokens,
    costMicros: command.costMicros,
  });
  const updatedRow = await patchRun(tx, row, { usage: mergedUsage }, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return {
    run,
    eventCursor: run.eventCursor,
    ledgerCursor: 0,
    committedEvents,
    attemptId,
    attemptIndex,
  };
};

export const pauseModelStepForBudgetTransition = async (
  tx: RelationalDatabase,
  command: PauseModelStepForBudgetCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const step = await tx.queryOne<{ status: string }>(
    'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
    [command.stepId, command.runId, command.runtimeId],
  );
  if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a
     JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.stepId, command.runId],
  );
  if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

  const attemptChanged = await tx.execute(
    `UPDATE agent_model_attempts SET status = 'failed', input_tokens = ?, output_tokens = ?,
       cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?, error_code = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      command.inputTokens ?? null,
      command.outputTokens ?? null,
      command.cachedInputTokens ?? null,
      command.costMicros ?? null,
      command.priceVersion ?? null,
      command.estimatedUsage ? 1 : 0,
      command.errorCode,
      command.now,
      command.attemptId,
    ],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.stepId, command.runId],
  );
  if (attemptChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('ATTEMPT_STATE_CONFLICT');
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'waiting_budget', updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
    [command.now, command.runtimeId, command.runId],
  );
  if (runtimeChanged.changes !== 1) throw new Error('RUNTIME_NOT_SCHEDULABLE');

  const events: DurableEventInput[] = [
    {
      type: 'model.failed',
      payload: { stepId: command.stepId, attemptId: command.attemptId, errorCode: command.errorCode },
    },
    { type: 'budget.increase_requested', payload: command.budgetReason },
    { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_budget' } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithDelta(row, {
    inputTokens: command.inputTokens,
    outputTokens: command.outputTokens,
    cachedInputTokens: command.cachedInputTokens,
    costMicros: command.costMicros,
  });
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const activeDelta =
    nextExecuting === 0 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET status = 'awaiting_budget', usage_json = ?,
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
  const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updatedRow) throw new Error('NOT_FOUND');
  await tx.execute(
    `UPDATE agent_apps SET budget_request_count = budget_request_count + 1, updated_at = ?
     WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const settleModelStepTransition = async (
  tx: RelationalDatabase,
  command: SettleModelStepCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (!['running', 'cancelling'].includes(row.status)) throw new Error('RUN_NOT_SETTLEABLE');
  const step = await tx.queryOne<{ status: string }>(
    'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
    [command.stepId, command.runId, command.runtimeId],
  );
  if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.stepId, command.runId],
  );
  if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

  const succeeded = command.terminalStatus === 'completed_unverified';
  await tx.execute(
    `UPDATE agent_model_attempts SET
       status = ?, input_tokens = ?, output_tokens = ?, cached_input_tokens = ?, cost_micros = ?,
       price_version = ?, estimated = ?, error_code = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      succeeded ? 'completed' : command.terminalStatus === 'cancelled' ? 'aborted' : 'failed',
      command.inputTokens ?? null,
      command.outputTokens ?? null,
      command.cachedInputTokens ?? null,
      command.costMicros ?? null,
      command.priceVersion ?? null,
      command.estimatedUsage ? 1 : 0,
      command.errorCode ?? null,
      command.now,
      command.attemptId,
    ],
  );
  await tx.execute(
    `UPDATE agent_steps SET status = ?, completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [
      succeeded ? 'completed' : command.terminalStatus === 'cancelled' ? 'cancelled' : 'failed',
      command.now,
      command.stepId,
      command.runId,
    ],
  );
  await tx.execute(
    `UPDATE agent_runtimes SET status = ?, schedule_state = 'finished', updated_at = ? WHERE id = ? AND run_id = ?`,
    [
      command.terminalStatus === 'cancelled' ? 'stopped' : succeeded ? 'stopped' : 'failed',
      command.now,
      command.runtimeId,
      command.runId,
    ],
  );

  let ledgerCursor = 0;
  if (command.assistantText !== undefined && command.assistantEntryId) {
    ledgerCursor = await appendLedger(
      tx,
      row,
      [
        {
          id: command.assistantEntryId,
          runId: command.runId,
          kind: 'assistant_message',
          payload: { text: command.assistantText },
        },
      ],
      command.now,
    );
  }
  const events: DurableEventInput[] = succeeded
    ? [
        {
          type: 'model.completed',
          payload: {
            stepId: command.stepId,
            attemptId: command.attemptId,
            finishReason: command.finishReason ?? null,
            inputTokens: command.inputTokens ?? null,
            outputTokens: command.outputTokens ?? null,
          },
        },
        { type: 'message.final', payload: { text: command.assistantText ?? '' } },
        {
          type: 'verification.completed',
          payload: { status: 'unverified', summary: 'No tool evidence was required.' },
        },
        { type: 'run.status_changed', payload: { from: row.status, to: command.terminalStatus } },
      ]
    : [
        {
          type: command.terminalStatus === 'cancelled' ? 'model.aborted' : 'model.failed',
          payload: { stepId: command.stepId, attemptId: command.attemptId, errorCode: command.errorCode ?? null },
        },
        { type: 'run.status_changed', payload: { from: row.status, to: command.terminalStatus } },
      ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const activeStarted = await tx.queryOne<{ active_execution_started_at: number | null }>(
    'SELECT active_execution_started_at FROM agent_runs WHERE id = ?',
    [command.runId],
  );
  const activeDelta = activeStarted?.active_execution_started_at
    ? Math.max(0, command.now - activeStarted.active_execution_started_at)
    : 0;
  const mergedUsage = usageWithDelta(row, {
    inputTokens: command.inputTokens,
    outputTokens: command.outputTokens,
    cachedInputTokens: command.cachedInputTokens,
    costMicros: command.costMicros,
    steps: 1,
  });
  const updated = await tx.execute(
    `UPDATE agent_runs SET
       status = ?, verification_status = ?, goal_status = ?, needs_reconciliation = 0,
       usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
       active_execution_started_at = NULL, executing_runtime_count = 0,
       completed_at = ?, updated_at = ?, next_event_sequence = next_event_sequence + ?, version = version + 1
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [
      command.terminalStatus,
      succeeded ? 'unverified' : command.terminalStatus === 'cancelled' ? 'not_started' : 'failed',
      succeeded ? 'satisfied' : command.terminalStatus === 'cancelled' ? row.goal_status : 'not_satisfied',
      JSON.stringify(mergedUsage),
      activeDelta,
      command.now,
      command.now,
      events.length,
      command.runId,
      command.scope.userId,
      command.scope.appId,
      row.version,
    ],
  );
  if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
  await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
  const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [command.runId]);
  if (!updatedRow) throw new Error('NOT_FOUND');
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const supersedeModelStepTransition = async (
  tx: RelationalDatabase,
  command: SupersedeModelStepCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision <= command.expectedInputRevision) throw new Error('INPUT_REVISION_CONFLICT');
  const step = await tx.queryOne<{ status: string; input_watermark: number }>(
    `SELECT status, input_watermark FROM agent_steps
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'model'`,
    [command.stepId, command.runId, command.runtimeId],
  );
  if (!step || step.status !== 'running' || step.input_watermark !== command.expectedInputRevision) {
    throw new Error('STEP_STATE_CONFLICT');
  }
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a
     JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.stepId, command.runId],
  );
  if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

  const attemptChanged = await tx.execute(
    `UPDATE agent_model_attempts SET status = 'aborted', input_tokens = ?, output_tokens = ?,
       cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?,
       error_code = 'NEW_INPUT', completed_at = ?
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
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.stepId, command.runId],
  );
  if (attemptChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('ATTEMPT_STATE_CONFLICT');

  const events: DurableEventInput[] = [
    {
      type: 'model.aborted',
      payload: {
        stepId: command.stepId,
        attemptId: command.attemptId,
        reason: 'new_input',
        previousInputRevision: command.expectedInputRevision,
        currentInputRevision: row.input_revision,
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
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};
