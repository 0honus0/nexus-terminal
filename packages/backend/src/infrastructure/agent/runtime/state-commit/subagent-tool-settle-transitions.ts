import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type {
  DurableEventInput,
  SettleSubagentToolCommand,
  SettleSubagentWithoutModelCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS } from '../../repositories/sqlite-run.mapper';
import type { RunRow } from '../../repositories/sqlite-run.mapper';
import { enqueueParentJoinResume } from '../subagent-join-wake';
import { linkVerifiedToolEvidence } from './artifact-evidence';
import { parseRunBudget, parseRunUsage, parseToolResult } from '../durable-state-decoders';
import {
  allocateHostEvent,
  appendEvents,
  cancelRunSubagentWork,
  COUNTED_LIVE,
  summaryPayload,
  updateAppLiveCount,
  usageWithDelta,
} from './transaction-primitives';

export const settleSubagentToolTransition = async (
  tx: RelationalDatabase,
  command: SettleSubagentToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (!['running', 'awaiting_budget', 'cancelling'].includes(row.status)) throw new Error('RUN_NOT_SETTLEABLE');
  const work = await tx.queryOne<{ status: string; owner_epoch: number | null; version: number }>(
    `SELECT status, owner_epoch, version FROM agent_scheduler_work
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'tool_step'`,
    [command.workId, command.runId, command.runtimeId],
  );
  if (!work || work.status !== 'claimed' || work.owner_epoch !== command.ownerEpoch) {
    throw new Error('SCHEDULER_WORK_STALE');
  }
  const delegation = await tx.queryOne<{
    status: string;
    child_runtime_id: string;
    deadline_at: number;
  }>(`SELECT status, child_runtime_id, deadline_at FROM agent_delegations WHERE id = ? AND run_id = ?`, [
    command.delegationId,
    command.runId,
  ]);
  if (!delegation || delegation.child_runtime_id !== command.runtimeId || delegation.status !== 'running') {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  const tool = await tx.queryOne<{ status: string; version: number; source_model_step_id: string | null }>(
    `SELECT status, version, source_model_step_id FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ? AND agent_runtime_id = ?`,
    [command.toolCallId, command.runId, command.toolStepId, command.runtimeId],
  );
  if (!tool || tool.status !== 'running') throw new Error('TOOL_STATE_CONFLICT');
  const safeResult = JSON.parse(JSON.stringify(command.result)) as JsonValue;
  await linkVerifiedToolEvidence(tx, row, command.result, command.now);
  const unknownMutation = command.result.outcome === 'unknown' || command.needsReconciliation === true;
  if (unknownMutation) {
    const toolChanged = await tx.execute(
      `UPDATE agent_tool_calls SET status = 'reconciling', result_json = ?, completed_at = ?, version = version + 1
       WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
      [JSON.stringify(safeResult), command.now, command.toolCallId, command.runId, tool.version],
    );
    const stepChanged = await tx.execute(
      `UPDATE agent_steps SET status = 'failed', output_refs_json = ?, completed_at = ?
       WHERE id = ? AND run_id = ? AND status = 'running'`,
      [JSON.stringify(command.result.artifactRefs), command.now, command.toolStepId, command.runId],
    );
    const delegationChanged = await tx.execute(
      `UPDATE agent_delegations SET status = 'failed', result_json = ?, version = version + 1,
       updated_at = ?, completed_at = ?
       WHERE id = ? AND run_id = ? AND status = 'running'`,
      [
        JSON.stringify({ errorCode: command.result.errorCode ?? 'MUTATION_OUTCOME_UNKNOWN' }),
        command.now,
        command.now,
        command.delegationId,
        command.runId,
      ],
    );
    const workChanged = await tx.execute(
      `UPDATE agent_scheduler_work SET status = 'completed', version = version + 1, updated_at = ?
       WHERE id = ? AND status = 'claimed' AND owner_epoch = ? AND version = ?`,
      [command.now, command.workId, command.ownerEpoch, work.version],
    );
    if (
      toolChanged.changes !== 1 ||
      stepChanged.changes !== 1 ||
      delegationChanged.changes !== 1 ||
      workChanged.changes !== 1
    ) {
      throw new Error('TOOL_STATE_CONFLICT');
    }
    await cancelRunSubagentWork(tx, row.id, command.now, true);
    await tx.execute(
      `UPDATE agent_runtimes SET status = 'failed', schedule_state = 'finished', updated_at = ?
       WHERE run_id = ? AND status IN ('created','running','stopping')`,
      [command.now, row.id],
    );
    const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
    const events: DurableEventInput[] = [
      {
        type: 'tool.reconciliation_required',
        payload: {
          toolCallId: command.toolCallId,
          toolStepId: command.toolStepId,
          runtimeId: command.runtimeId,
          outcome: command.result.outcome,
        },
      },
      { type: 'run.interrupted', payload: { reason: 'mutation_outcome_unknown', needsReconciliation: true } },
      { type: 'run.status_changed', payload: { from: row.status, to: 'interrupted' } },
    ];
    const committedEvents = await appendEvents(tx, row, events, command.now);
    const activeDelta =
      nextExecuting === 0 && row.active_execution_started_at !== null
        ? Math.max(0, command.now - row.active_execution_started_at)
        : 0;
    const mergedUsage = usageWithDelta(row, { steps: 1 });
    const changedRun = await tx.execute(
      `UPDATE agent_runs SET status = 'interrupted', needs_reconciliation = 1, completed_at = ?,
       usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
       active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
       executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?,
       version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
      [
        command.now,
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
    if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
    const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
    if (!updated) throw new Error('NOT_FOUND');
    const run = mapRunRow(updated);
    await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
    return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
  }
  const toolStatus = command.result.ok ? 'succeeded' : 'failed';
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = ?, result_json = ?, completed_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
    [toolStatus, JSON.stringify(safeResult), command.now, command.toolCallId, command.runId, tool.version],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = ?, output_refs_json = ?, completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [
      command.result.ok ? 'completed' : 'failed',
      JSON.stringify(command.result.artifactRefs),
      command.now,
      command.toolStepId,
      command.runId,
    ],
  );
  if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const cancelling = row.status === 'cancelling';
  const batchRows = tool.source_model_step_id
    ? await tx.queryAll<{ tool_name: string; status: string; result_json: string | null }>(
        `SELECT tool_name, status, result_json FROM agent_tool_calls
         WHERE run_id = ? AND agent_runtime_id = ? AND source_model_step_id = ?
         ORDER BY batch_index, created_at, id`,
        [command.runId, command.runtimeId, tool.source_model_step_id],
      )
    : [];
  const hasRemainingBatch = batchRows.some((item) => ['proposed', 'running'].includes(item.status));
  let batchContinuation: SettleSubagentToolCommand['continuation'] = hasRemainingBatch
    ? 'runnable'
    : command.continuation;
  let batchBudgetReason = command.budgetReason;
  if (!cancelling && !hasRemainingBatch && batchRows.length > 0) {
    let joinPending = false;
    for (const item of batchRows) {
      if (!item.result_json) continue;
      const result = parseToolResult(item.result_json);
      if (
        item.tool_name === 'send_agent_message' &&
        (result.errorCode === 'MAILBOX_BUDGET_EXCEEDED' || result.errorCode === 'MAILBOX_HARD_LIMIT_EXCEEDED')
      ) {
        const currentUsage = parseRunUsage(row.usage_json);
        const currentBudget = parseRunBudget(row.budget_json);
        batchContinuation = 'waiting_budget';
        batchBudgetReason = {
          scope: 'mailbox',
          runtimeId: command.runtimeId,
          delegationId: command.delegationId,
          canIncrease: result.errorCode === 'MAILBOX_BUDGET_EXCEEDED',
          errorCode: result.errorCode,
          messages: currentUsage.subagentMessages,
          bytes: currentUsage.subagentMessageBytes,
          maxMessages: currentBudget.maxSubagentMessages,
          maxBytes: currentBudget.maxSubagentMessageBytes,
        };
        break;
      }
      if (
        item.tool_name === 'join_subagents' &&
        result.ok &&
        result.data &&
        typeof result.data === 'object' &&
        !Array.isArray(result.data) &&
        result.data.ready === false
      ) {
        joinPending = true;
      }
    }
    if (batchContinuation !== 'waiting_budget' && joinPending) batchContinuation = 'joining';
  }
  const waitingBudget = !cancelling && !hasRemainingBatch && batchContinuation === 'waiting_budget';
  const nextSchedule = cancelling ? 'finished' : batchContinuation;
  const nextDelegationStatus = cancelling ? 'cancelled' : batchContinuation === 'runnable' ? 'running' : 'waiting';
  const delegationChanged = await tx.execute(
    `UPDATE agent_delegations SET status = ?, version = version + 1, updated_at = ?,
     completed_at = CASE WHEN ? = 'cancelled' THEN ? ELSE completed_at END
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [nextDelegationStatus, command.now, nextDelegationStatus, command.now, command.delegationId, command.runId],
  );
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET status = ?, schedule_state = ?, updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
    [cancelling ? 'stopped' : 'running', nextSchedule, command.now, command.runtimeId, command.runId],
  );
  const workChanged = await tx.execute(
    `UPDATE agent_scheduler_work SET status = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND status = 'claimed' AND owner_epoch = ? AND version = ?`,
    [cancelling ? 'cancelled' : 'completed', command.now, command.workId, command.ownerEpoch, work.version],
  );
  if (delegationChanged.changes !== 1 || runtimeChanged.changes !== 1 || workChanged.changes !== 1) {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const finalCancellation = cancelling && nextExecuting === 0;
  if (finalCancellation) await cancelRunSubagentWork(tx, row.id, command.now, true);
  if (
    !cancelling &&
    !hasRemainingBatch &&
    (batchContinuation === 'runnable' || waitingBudget) &&
    row.status === 'running'
  ) {
    await tx.execute(
      `INSERT INTO agent_scheduler_work
        (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
         deadline_at, created_at, updated_at, version)
       VALUES (?, ?, ?, 'model_step', 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
      [
        `work-${randomUUID()}`,
        command.runId,
        command.runtimeId,
        JSON.stringify({ delegationId: command.delegationId, cause: 'tool_result' }),
        command.now,
        delegation.deadline_at,
        command.now,
        command.now,
      ],
    );
  }
  const events: DurableEventInput[] = [
    {
      type: command.result.ok ? 'tool.completed' : 'tool.failed',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        runtimeId: command.runtimeId,
        ok: command.result.ok,
        summary: command.result.summary,
        verification: command.result.verification.status,
      },
    },
  ];
  if (waitingBudget) {
    events.push(
      { type: 'budget.increase_requested', payload: batchBudgetReason ?? { scope: 'subagent_tool' } },
      { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_budget' } },
    );
  }
  if (cancelling) {
    events.push({
      type: 'subagent.cancelled',
      payload: { delegationId: command.delegationId, runtimeId: command.runtimeId, reason: 'run_cancelling' },
    });
  }
  if (finalCancellation) {
    events.push(
      { type: 'run.cancelled', payload: { reason: 'participants_settled' } },
      { type: 'run.status_changed', payload: { from: 'cancelling', to: 'cancelled' } },
    );
  }
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const activeDelta =
    nextExecuting === 0 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const mergedUsage = usageWithDelta(row, { steps: 1 });
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET status = ?, completed_at = CASE WHEN ? = 'cancelled' THEN ? ELSE completed_at END,
     usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
     active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
     executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [
      finalCancellation ? 'cancelled' : waitingBudget ? 'awaiting_budget' : row.status,
      finalCancellation ? 'cancelled' : waitingBudget ? 'awaiting_budget' : row.status,
      command.now,
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
  if (waitingBudget) {
    await tx.execute(
      `UPDATE agent_apps SET budget_request_count = budget_request_count + 1, updated_at = ?
       WHERE user_id = ? AND app_id = ?`,
      [command.now, row.user_id, row.app_id],
    );
  } else if (finalCancellation) {
    await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
  }
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const settleSubagentWithoutModelTransition = async (
  tx: RelationalDatabase,
  command: SettleSubagentWithoutModelCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (!['running', 'awaiting_budget', 'cancelling'].includes(row.status)) throw new Error('RUN_NOT_SETTLEABLE');
  const work = await tx.queryOne<{ status: string; owner_epoch: number | null; version: number }>(
    `SELECT status, owner_epoch, version FROM agent_scheduler_work
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind IN ('model_step','tool_step')`,
    [command.workId, command.runId, command.runtimeId],
  );
  if (!work || work.status !== 'claimed' || work.owner_epoch !== command.ownerEpoch) {
    throw new Error('SCHEDULER_WORK_STALE');
  }
  const delegation = await tx.queryOne<{ status: string; child_runtime_id: string; parent_runtime_id: string }>(
    `SELECT status, child_runtime_id, parent_runtime_id FROM agent_delegations WHERE id = ? AND run_id = ?`,
    [command.delegationId, command.runId],
  );
  if (
    !delegation ||
    delegation.child_runtime_id !== command.runtimeId ||
    !['queued', 'running', 'waiting'].includes(delegation.status)
  ) {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  const delegationStatus = command.outcome === 'cancelled' ? 'cancelled' : 'failed';
  const delegationChanged = await tx.execute(
    `UPDATE agent_delegations SET status = ?, result_json = ?, version = version + 1,
     updated_at = ?, completed_at = ?
     WHERE id = ? AND run_id = ? AND status IN ('queued','running','waiting')`,
    [
      delegationStatus,
      command.result === null ? null : JSON.stringify(command.result),
      command.now,
      command.now,
      command.delegationId,
      command.runId,
    ],
  );
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET status = ?, schedule_state = 'finished', updated_at = ?
     WHERE id = ? AND run_id = ? AND status IN ('created','running','interrupted')`,
    [command.outcome === 'cancelled' ? 'stopped' : 'failed', command.now, command.runtimeId, command.runId],
  );
  const workChanged = await tx.execute(
    `UPDATE agent_scheduler_work SET status = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND status = 'claimed' AND owner_epoch = ? AND version = ?`,
    [
      command.outcome === 'cancelled' ? 'cancelled' : 'completed',
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
  const events: DurableEventInput[] = [
    {
      type: command.outcome === 'cancelled' ? 'subagent.cancelled' : 'subagent.failed',
      payload: {
        delegationId: command.delegationId,
        runtimeId: command.runtimeId,
        errorCode: command.errorCode,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [events.length, command.now, row.id, row.user_id, row.app_id, row.version],
  );
  if (changedRun.changes !== 1) throw new Error('STATE_CONFLICT');
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};
