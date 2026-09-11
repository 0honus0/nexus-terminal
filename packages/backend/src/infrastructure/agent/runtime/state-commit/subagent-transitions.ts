import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type {
  BeginModelStepResult,
  BeginSubagentModelStepCommand,
  BeginSubagentToolCommand,
  CommitSubagentToolProposalCommand,
  CommitToolProposalResult,
  DurableEventInput,
  ParkRuntimeCommand,
  PauseRuntimeForBudgetCommand,
  SettleSubagentModelStepCommand,
  SettleSubagentToolCommand,
  SettleSubagentWithoutModelCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunBudget, RunUsage } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import { allocateHostEvent, appendEvents, summaryPayload, usageWithDelta } from './transaction-primitives';

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
    max_tokens: number;
    max_steps: number;
    used_tokens: number;
    used_steps: number;
    deadline_at: number;
  }>(
    `SELECT status, child_runtime_id, max_tokens, max_steps, used_tokens, used_steps, deadline_at
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
  if (
    delegation.used_steps >= delegation.max_steps ||
    delegation.used_tokens + command.reservedTokens > delegation.max_tokens
  ) {
    throw new Error('DELEGATION_BUDGET_EXCEEDED');
  }
  const work = await tx.queryOne<{ status: string; owner_epoch: number | null }>(
    `SELECT status, owner_epoch FROM agent_scheduler_work
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'model_step'`,
    [command.workId, command.runId, command.runtimeId],
  );
  if (!work || work.status !== 'claimed' || work.owner_epoch !== command.ownerEpoch) {
    throw new Error('SCHEDULER_WORK_STALE');
  }
  const budget = JSON.parse(row.budget_json) as RunBudget;
  const usage = JSON.parse(row.usage_json) as RunUsage;
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
       cached_input_tokens, cost_micros, price_version, estimated, error_code, created_at, completed_at)
     VALUES (?, ?, 1, 'streaming', ?, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
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

export const commitSubagentToolProposalTransition = async (
  tx: RelationalDatabase,
  command: CommitSubagentToolProposalCommand,
): Promise<CommitToolProposalResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.inspection.inputRevision) throw new Error('INPUT_REVISION_CONFLICT');
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
    used_tokens: number;
    max_tokens: number;
    used_steps: number;
    max_steps: number;
    deadline_at: number;
  }>(
    `SELECT status, child_runtime_id, used_tokens, max_tokens, used_steps, max_steps, deadline_at
     FROM agent_delegations WHERE id = ? AND run_id = ?`,
    [command.delegationId, command.runId],
  );
  if (!delegation || delegation.child_runtime_id !== command.runtimeId || delegation.status !== 'running') {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  const tokenDelta = command.inputTokens + command.outputTokens;
  if (delegation.used_tokens + tokenDelta > delegation.max_tokens || delegation.used_steps >= delegation.max_steps) {
    throw new Error('DELEGATION_BUDGET_EXCEEDED');
  }
  const runUsage = JSON.parse(row.usage_json) as RunUsage;
  const runBudget = JSON.parse(row.budget_json) as RunBudget;
  if (runUsage.steps >= runBudget.maxRunSteps) throw new Error('RUN_BUDGET_EXCEEDED');
  const step = await tx.queryOne<{ status: string }>(
    `SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'model'`,
    [command.modelStepId, command.runId, command.runtimeId],
  );
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.modelStepId, command.runId],
  );
  if (!step || step.status !== 'running' || !attempt || attempt.status !== 'streaming') {
    throw new Error('ATTEMPT_STATE_CONFLICT');
  }
  const attemptChanged = await tx.execute(
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
  const modelStepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'completed', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.modelStepId, command.runId],
  );
  if (attemptChanged.changes !== 1 || modelStepChanged.changes !== 1) throw new Error('ATTEMPT_STATE_CONFLICT');
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
  const delegationChanged = await tx.execute(
    `UPDATE agent_delegations SET used_tokens = used_tokens + ?, used_steps = used_steps + 1,
     version = version + 1, updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND used_steps < max_steps`,
    [tokenDelta, command.now, command.delegationId, command.runId],
  );
  if (delegationChanged.changes !== 1) throw new Error('DELEGATION_BUDGET_EXCEEDED');
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'runnable', updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
    [command.now, command.runtimeId, command.runId],
  );
  const workChanged = await tx.execute(
    `UPDATE agent_scheduler_work SET status = 'completed', version = version + 1, updated_at = ?
     WHERE id = ? AND status = 'claimed' AND owner_epoch = ? AND version = ?`,
    [command.now, command.workId, command.ownerEpoch, work.version],
  );
  if (runtimeChanged.changes !== 1 || workChanged.changes !== 1) throw new Error('SCHEDULER_WORK_STALE');
  await tx.execute(
    `INSERT INTO agent_scheduler_work
      (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
       deadline_at, created_at, updated_at, version)
     VALUES (?, ?, ?, 'tool_step', 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
    [
      `work-${randomUUID()}`,
      command.runId,
      command.runtimeId,
      JSON.stringify({
        delegationId: command.delegationId,
        toolStepId,
        toolCallId: command.toolCallId,
      }),
      command.now,
      Math.min(delegation.deadline_at, command.now + (JSON.parse(row.budget_json) as RunBudget).toolTimeoutSeconds),
      command.now,
      command.now,
    ],
  );
  const events: DurableEventInput[] = [
    {
      type: 'model.completed',
      payload: {
        stepId: command.modelStepId,
        attemptId: command.attemptId,
        runtimeId: command.runtimeId,
        finishReason: command.finishReason ?? 'tool_calls',
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
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
        runtimeId: command.runtimeId,
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
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const activeDelta =
    nextExecuting === 0 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
     active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
     executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?,
     version = version + 1, updated_at = ?
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
  return {
    run,
    eventCursor: run.eventCursor,
    ledgerCursor: 0,
    committedEvents,
    toolStepId,
    toolCallId: command.toolCallId,
  };
};

export const beginSubagentToolTransition = async (
  tx: RelationalDatabase,
  command: BeginSubagentToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.status !== 'running') throw new Error('RUN_NOT_SCHEDULABLE');
  const work = await tx.queryOne<{ status: string; owner_epoch: number | null }>(
    `SELECT status, owner_epoch FROM agent_scheduler_work
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'tool_step'`,
    [command.workId, command.runId, command.runtimeId],
  );
  if (!work || work.status !== 'claimed' || work.owner_epoch !== command.ownerEpoch) {
    throw new Error('SCHEDULER_WORK_STALE');
  }
  const delegation = await tx.queryOne<{ status: string; child_runtime_id: string; deadline_at: number }>(
    `SELECT status, child_runtime_id, deadline_at FROM agent_delegations WHERE id = ? AND run_id = ?`,
    [command.delegationId, command.runId],
  );
  if (
    !delegation ||
    delegation.child_runtime_id !== command.runtimeId ||
    !['running', 'waiting'].includes(delegation.status) ||
    delegation.deadline_at <= command.now
  ) {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  const step = await tx.queryOne<{ status: string }>(
    `SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'tool'`,
    [command.toolStepId, command.runId, command.runtimeId],
  );
  const tool = await tx.queryOne<{ status: string; version: number }>(
    `SELECT status, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ? AND agent_runtime_id = ?`,
    [command.toolCallId, command.runId, command.toolStepId, command.runtimeId],
  );
  if (!step || step.status !== 'created' || !tool || tool.status !== 'proposed') {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'running'
     WHERE id = ? AND run_id = ? AND status = 'created'`,
    [command.toolStepId, command.runId],
  );
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'running', started_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
    [command.now, command.toolCallId, command.runId, tool.version],
  );
  if (stepChanged.changes !== 1 || toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const events: DurableEventInput[] = [
    {
      type: 'tool.started',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        runtimeId: command.runtimeId,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET
     active_execution_started_at = CASE WHEN executing_runtime_count = 0 THEN ? ELSE active_execution_started_at END,
     executing_runtime_count = executing_runtime_count + 1,
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
  const tool = await tx.queryOne<{ status: string; version: number }>(
    `SELECT status, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ? AND agent_runtime_id = ?`,
    [command.toolCallId, command.runId, command.toolStepId, command.runtimeId],
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
  const waitingBudget = !cancelling && command.continuation === 'waiting_budget';
  const nextSchedule = cancelling ? 'finished' : command.continuation;
  const nextDelegationStatus = cancelling ? 'cancelled' : command.continuation === 'runnable' ? 'running' : 'waiting';
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
  if (!cancelling && (command.continuation === 'runnable' || waitingBudget) && row.status === 'running') {
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
    ...(waitingBudget
      ? [
          { type: 'budget.increase_requested', payload: command.budgetReason ?? { scope: 'subagent_tool' } },
          { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_budget' } },
        ]
      : []),
    ...(cancelling
      ? [
          {
            type: 'subagent.cancelled',
            payload: { delegationId: command.delegationId, runtimeId: command.runtimeId, reason: 'run_cancelling' },
          } as const,
        ]
      : []),
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const activeDelta =
    nextExecuting === 0 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  const mergedUsage = usageWithDelta(row, { steps: 1 });
  const changedRun = await tx.execute(
    `UPDATE agent_runs SET status = ?, usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
     active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
     executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [
      waitingBudget ? 'awaiting_budget' : row.status,
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
  const delegation = await tx.queryOne<{ status: string; child_runtime_id: string }>(
    `SELECT status, child_runtime_id FROM agent_delegations WHERE id = ? AND run_id = ?`,
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
    used_tokens: number;
    max_tokens: number;
  }>(`SELECT status, child_runtime_id, used_tokens, max_tokens FROM agent_delegations WHERE id = ? AND run_id = ?`, [
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
  const delegationBudgetExceeded = delegation.used_tokens + tokenDelta > delegation.max_tokens;
  const effectiveOutcome = delegationBudgetExceeded && command.outcome === 'completed' ? 'failed' : command.outcome;
  const effectiveErrorCode = delegationBudgetExceeded ? 'DELEGATION_BUDGET_EXCEEDED' : command.errorCode;
  const effectiveResult = delegationBudgetExceeded
    ? ({
        ...(command.result && typeof command.result === 'object' && !Array.isArray(command.result)
          ? command.result
          : {}),
        errorCode: 'DELEGATION_BUDGET_EXCEEDED',
      } as JsonValue)
    : command.result;
  const attemptStatus =
    effectiveOutcome === 'completed' ? 'completed' : effectiveOutcome === 'cancelled' ? 'aborted' : 'failed';
  const stepStatus =
    effectiveOutcome === 'completed' ? 'completed' : effectiveOutcome === 'cancelled' ? 'cancelled' : 'failed';
  const delegationStatus =
    effectiveOutcome === 'completed' ? 'completed' : effectiveOutcome === 'cancelled' ? 'cancelled' : 'failed';
  await tx.execute(
    `UPDATE agent_model_attempts SET status = ?, input_tokens = ?, output_tokens = ?, cached_input_tokens = ?,
     cost_micros = ?, price_version = ?, estimated = ?, error_code = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      attemptStatus,
      command.inputTokens,
      command.outputTokens,
      command.cachedInputTokens,
      command.costMicros,
      command.priceVersion,
      command.estimatedUsage ? 1 : 0,
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
  const currentUsage = JSON.parse(row.usage_json) as RunUsage;
  const nextUsage: RunUsage = {
    inputTokens: currentUsage.inputTokens + command.inputTokens,
    outputTokens: currentUsage.outputTokens + command.outputTokens,
    cachedInputTokens: currentUsage.cachedInputTokens + command.cachedInputTokens,
    costMicros: currentUsage.costMicros + command.costMicros,
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
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [
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
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};
