import { randomUUID } from 'node:crypto';
import type {
  BeginModelStepResult,
  BeginSubagentModelStepCommand,
  DurableEventInput,
  ParkRuntimeCommand,
  PauseRuntimeForBudgetCommand,
  SettleSubagentModelStepCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import { encodeModelProviderContinuation } from '../../../../modules/agent/ai/model-continuation';
import type { RunUsage } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS } from '../../repositories/sqlite-run.mapper';
import type { RunRow } from '../../repositories/sqlite-run.mapper';
import { enqueueParentJoinResume } from '../subagent-join-wake';
import { parseRunBudget, parseRunUsage } from '../durable-state-decoders';
import {
  allocateHostEvent,
  appendEvents,
  cancelRunSubagentWork,
  summaryPayload,
  updateAppLiveCount,
} from './transaction-primitives';

export const beginSubagentModelStepTransition = async (
  tx: RelationalDatabase,
  command: BeginSubagentModelStepCommand,
): Promise<BeginModelStepResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.status !== 'running') throw new Error('RUN_NOT_SCHEDULABLE');
  const runtime = await tx.queryOne<{ status: string; schedule_state: string }>(
    `SELECT status, schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?`,
    [command.runtimeId, command.runId],
  );
  if (!runtime || !['created', 'running'].includes(runtime.status)) throw new Error('RUNTIME_NOT_SCHEDULABLE');
  const delegation = await tx.queryOne<{
    status: string;
    child_runtime_id: string;
    max_steps: number;
    used_steps: number;
    deadline_at: number;
  }>(
    `SELECT status, child_runtime_id, max_steps, used_steps, deadline_at
     FROM agent_delegations WHERE id = ? AND run_id = ?`,
    [command.delegationId, command.runId],
  );
  if (
    !delegation ||
    delegation.child_runtime_id !== command.runtimeId ||
    !['queued', 'running', 'waiting'].includes(delegation.status)
  ) {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  if (delegation.deadline_at <= command.now) throw new Error('DELEGATION_DEADLINE_EXCEEDED');
  if (delegation.used_steps >= delegation.max_steps) throw new Error('DELEGATION_BUDGET_EXCEEDED');
  const work = await tx.queryOne<{ status: string; owner_epoch: number | null }>(
    `SELECT status, owner_epoch FROM agent_scheduler_work
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'model_step'`,
    [command.workId, command.runId, command.runtimeId],
  );
  if (!work || work.status !== 'claimed' || work.owner_epoch !== command.ownerEpoch) {
    throw new Error('SCHEDULER_WORK_STALE');
  }
  const budget = parseRunBudget(row.budget_json);
  const usage = parseRunUsage(row.usage_json);
  if (usage.steps >= budget.maxRunSteps) throw new Error('RUN_BUDGET_EXCEEDED');
  const previous = await tx.queryOne<{ max_index: number | null }>(
    'SELECT MAX(step_index) AS max_index FROM agent_steps WHERE run_id = ?',
    [command.runId],
  );
  const stepId = randomUUID();
  const attemptId = randomUUID();
  const stepIndex = (previous?.max_index ?? 0) + 1;
  await tx.execute(
    `INSERT INTO agent_steps
      (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
       input_refs_json, output_refs_json, created_at, completed_at)
     VALUES (?, ?, ?, ?, 'model', 'running', 0, '[]', '[]', ?, NULL)`,
    [stepId, command.runId, command.runtimeId, stepIndex, command.now],
  );
  await tx.execute(
    `INSERT INTO agent_model_attempts
      (id, step_id, attempt_index, status, reserved_tokens, input_tokens, output_tokens,
       cached_input_tokens, estimated, error_code, created_at, completed_at)
     VALUES (?, ?, 1, 'streaming', ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
    [attemptId, stepId, command.reservedTokens, command.now],
  );
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET status = 'running', schedule_state = 'executing', updated_at = ?
     WHERE id = ? AND run_id = ? AND status IN ('created','running')`,
    [command.now, command.runtimeId, command.runId],
  );
  const delegationChanged = await tx.execute(
    `UPDATE agent_delegations SET status = 'running', used_steps = used_steps + 1,
     version = version + 1, updated_at = ?
     WHERE id = ? AND run_id = ? AND status IN ('queued','running','waiting') AND used_steps < max_steps`,
    [command.now, command.delegationId, command.runId],
  );
  if (runtimeChanged.changes !== 1 || delegationChanged.changes !== 1) throw new Error('DELEGATION_STATE_CONFLICT');
  const events: DurableEventInput[] = [
    {
      type: 'subagent.started',
      payload: { delegationId: command.delegationId, runtimeId: command.runtimeId, workId: command.workId },
    },
    { type: 'model.started', payload: { stepId, attemptId, attemptIndex: 1, runtimeId: command.runtimeId } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const nextUsage: RunUsage = { ...usage, steps: usage.steps + 1 };
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET usage_json = ?,
       active_execution_started_at = CASE WHEN executing_runtime_count = 0 THEN ? ELSE active_execution_started_at END,
       executing_runtime_count = executing_runtime_count + 1,
       next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'running'`,
    [JSON.stringify(nextUsage), command.now, events.length, command.now, row.id, row.user_id, row.app_id, row.version],
  );
  if (changedRun.changes !== 1) throw new Error('STATE_CONFLICT');
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, stepId, attemptId, attemptIndex: 1, committedEvents };
};

export const pauseRuntimeForBudgetTransition = async (
  tx: RelationalDatabase,
  command: PauseRuntimeForBudgetCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'waiting_budget', updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
    [command.now, command.runtimeId, command.runId],
  );
  if (runtimeChanged.changes !== 1) throw new Error('RUNTIME_NOT_SCHEDULABLE');
  const events: DurableEventInput[] = [
    { type: 'budget.increase_requested', payload: command.budgetReason },
    { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_budget' } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const activeDelta =
    nextExecuting === 0 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET status = 'awaiting_budget',
     active_execution_seconds = active_execution_seconds + ?,
     active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
     executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'running'`,
    [
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
  await tx.execute(
    `UPDATE agent_apps SET budget_request_count = budget_request_count + 1, updated_at = ?
     WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const parkRuntimeTransition = async (
  tx: RelationalDatabase,
  command: ParkRuntimeCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  const scheduleState = command.reason === 'waiting_subagents' ? 'joining' : 'waiting_message';
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = ?, updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
    [scheduleState, command.now, command.runtimeId, command.runId],
  );
  if (runtimeChanged.changes !== 1) throw new Error('RUNTIME_NOT_SCHEDULABLE');
  const events: DurableEventInput[] = [
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
    `UPDATE agent_runs SET active_execution_seconds = active_execution_seconds + ?,
     active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
     executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'running'`,
    [
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

export const settleSubagentModelStepTransition = async (
  tx: RelationalDatabase,
  command: SettleSubagentModelStepCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (!['running', 'awaiting_budget', 'cancelling'].includes(row.status)) throw new Error('RUN_NOT_SETTLEABLE');
  const work = await tx.queryOne<{ status: string; owner_epoch: number | null; version: number }>(
    `SELECT status, owner_epoch, version FROM agent_scheduler_work
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'model_step'`,
    [command.workId, command.runId, command.runtimeId],
  );
  if (!work || work.status !== 'claimed' || work.owner_epoch !== command.ownerEpoch) {
    throw new Error('SCHEDULER_WORK_STALE');
  }
  const delegation = await tx.queryOne<{
    status: string;
    child_runtime_id: string;
    parent_runtime_id: string;
  }>(`SELECT status, child_runtime_id, parent_runtime_id FROM agent_delegations WHERE id = ? AND run_id = ?`, [
    command.delegationId,
    command.runId,
  ]);
  if (!delegation || delegation.child_runtime_id !== command.runtimeId || delegation.status !== 'running') {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
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
  const tokenDelta = command.inputTokens + command.outputTokens;
  const cancelling = row.status === 'cancelling';
  const effectiveOutcome = cancelling ? 'cancelled' : command.outcome;
  const effectiveErrorCode = command.errorCode;
  const effectiveResult = command.result;
  const attemptStatus =
    effectiveOutcome === 'completed' ? 'completed' : effectiveOutcome === 'cancelled' ? 'aborted' : 'failed';
  const stepStatus =
    effectiveOutcome === 'completed' ? 'completed' : effectiveOutcome === 'cancelled' ? 'cancelled' : 'failed';
  const delegationStatus =
    effectiveOutcome === 'completed' ? 'completed' : effectiveOutcome === 'cancelled' ? 'cancelled' : 'failed';
  await tx.execute(
    `UPDATE agent_model_attempts SET status = ?, input_tokens = ?, output_tokens = ?, cached_input_tokens = ?,
     estimated = ?, continuation_json = ?, error_code = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      attemptStatus,
      command.inputTokens,
      command.outputTokens,
      command.cachedInputTokens,
      command.estimatedUsage ? 1 : 0,
      command.providerContinuation ? encodeModelProviderContinuation(command.providerContinuation) : null,
      effectiveErrorCode ?? null,
      command.now,
      command.attemptId,
    ],
  );
  await tx.execute(
    `UPDATE agent_steps SET status = ?, output_refs_json = ?, completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [stepStatus, JSON.stringify(command.evidenceRefs), command.now, command.stepId, command.runId],
  );
  const delegationChanged = await tx.execute(
    `UPDATE agent_delegations SET status = ?, used_tokens = used_tokens + ?, result_json = ?, evidence_refs_json = ?,
     version = version + 1, updated_at = ?, completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [
      delegationStatus,
      tokenDelta,
      effectiveResult === null ? null : JSON.stringify(effectiveResult),
      JSON.stringify(command.evidenceRefs),
      command.now,
      command.now,
      command.delegationId,
      command.runId,
    ],
  );
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET status = ?, schedule_state = 'finished', updated_at = ?
     WHERE id = ? AND run_id = ? AND status IN ('created','running','interrupted')`,
    [effectiveOutcome === 'failed' ? 'failed' : 'stopped', command.now, command.runtimeId, command.runId],
  );
  const workChanged = await tx.execute(
    `UPDATE agent_scheduler_work SET status = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND status = 'claimed' AND owner_epoch = ? AND version = ?`,
    [
      effectiveOutcome === 'cancelled' ? 'cancelled' : 'completed',
      command.now,
      command.workId,
      command.ownerEpoch,
      work.version,
    ],
  );
  if (delegationChanged.changes !== 1 || runtimeChanged.changes !== 1 || workChanged.changes !== 1) {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  await enqueueParentJoinResume(tx, command.runId, delegation.parent_runtime_id, command.delegationId, command.now);
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const finalCancellation = cancelling && nextExecuting === 0;
  if (finalCancellation) await cancelRunSubagentWork(tx, row.id, command.now, true);
  const currentUsage = parseRunUsage(row.usage_json);
  const nextUsage: RunUsage = {
    ...currentUsage,
    inputTokens: currentUsage.inputTokens + command.inputTokens,
    outputTokens: currentUsage.outputTokens + command.outputTokens,
    cachedInputTokens: currentUsage.cachedInputTokens + command.cachedInputTokens,
    steps: currentUsage.steps,
    subagentMessages: currentUsage.subagentMessages,
    subagentMessageBytes: currentUsage.subagentMessageBytes,
  };
  const events: DurableEventInput[] = [
    {
      type:
        effectiveOutcome === 'completed'
          ? 'model.completed'
          : effectiveOutcome === 'cancelled'
            ? 'model.aborted'
            : 'model.failed',
      payload: {
        stepId: command.stepId,
        attemptId: command.attemptId,
        runtimeId: command.runtimeId,
        finishReason: command.finishReason,
        errorCode: effectiveErrorCode ?? null,
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
      },
    },
    {
      type:
        effectiveOutcome === 'completed'
          ? 'subagent.completed'
          : effectiveOutcome === 'cancelled'
            ? 'subagent.cancelled'
            : 'subagent.failed',
      payload: {
        delegationId: command.delegationId,
        runtimeId: command.runtimeId,
        evidenceRefs: command.evidenceRefs,
      },
    },
    ...(finalCancellation
      ? [
          { type: 'run.cancelled', payload: { reason: 'participants_settled' } } as const,
          { type: 'run.status_changed', payload: { from: 'cancelling', to: 'cancelled' } } as const,
        ]
      : []),
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const activeDelta =
    row.executing_runtime_count <= 1 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET status = ?, completed_at = CASE WHEN ? = 'cancelled' THEN ? ELSE completed_at END,
     usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
     active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
     executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [
      finalCancellation ? 'cancelled' : row.status,
      finalCancellation ? 'cancelled' : row.status,
      command.now,
      JSON.stringify(nextUsage),
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
  if (finalCancellation) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};
