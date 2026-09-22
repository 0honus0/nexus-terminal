import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type {
  BeginModelStepResult,
  BeginSubagentMutationToolCommand,
  BeginSubagentModelStepCommand,
  BeginSubagentToolCommand,
  CommitSubagentToolProposalBatchCommand,
  CommitToolProposalBatchResult,
  DurableEventInput,
  ParkRuntimeCommand,
  PauseRuntimeForBudgetCommand,
  SettleSubagentModelStepCommand,
  SettleSubagentToolCommand,
  SettleSubagentWithoutModelCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import { encodeModelProviderContinuation } from '../../../../modules/agent/ai/model-continuation';
import { governedSubagentWorkspaceMutation } from '../../../../modules/agent/runtime/collaboration/subagent-mutation-policy';
import type { RunUsage } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import { enqueueParentJoinResume } from '../subagent-join-wake';
import { linkVerifiedToolEvidence } from './artifact-evidence';
import { parseRunBudget, parseRunUsage, parseToolInspection, parseToolResult } from '../durable-state-decoders';
import {
  allocateHostEvent,
  appendEvents,
  cancelRunSubagentWork,
  COUNTED_LIVE,
  summaryPayload,
  updateAppLiveCount,
  usageWithDelta,
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

export const commitSubagentToolProposalBatchTransition = async (
  tx: RelationalDatabase,
  command: CommitSubagentToolProposalBatchCommand,
): Promise<CommitToolProposalBatchResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (command.items.length < 1 || command.items.length > 32) throw new Error('VALIDATION_FAILED');
  if (
    new Set(command.items.map((item) => item.providerCallId)).size !== command.items.length ||
    new Set(command.items.map((item) => item.toolCallId)).size !== command.items.length
  ) {
    throw new Error('MODEL_TOOL_CALL_INVALID');
  }
  if (command.items.some((item) => item.inspection.inputRevision !== row.input_revision)) {
    throw new Error('INPUT_REVISION_CONFLICT');
  }
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
    used_steps: number;
    max_steps: number;
    deadline_at: number;
  }>(
    `SELECT status, child_runtime_id, used_steps, max_steps, deadline_at
     FROM agent_delegations WHERE id = ? AND run_id = ?`,
    [command.delegationId, command.runId],
  );
  if (!delegation || delegation.child_runtime_id !== command.runtimeId || delegation.status !== 'running') {
    throw new Error('DELEGATION_STATE_CONFLICT');
  }
  const tokenDelta = command.inputTokens + command.outputTokens;
  if (delegation.used_steps + command.items.length > delegation.max_steps) {
    throw new Error('DELEGATION_BUDGET_EXCEEDED');
  }
  const runUsage = parseRunUsage(row.usage_json);
  const runBudget = parseRunBudget(row.budget_json);
  if (runUsage.steps + command.items.length > runBudget.maxRunSteps) throw new Error('RUN_BUDGET_EXCEEDED');
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
     cached_input_tokens = ?, estimated = ?, continuation_json = ?, error_code = NULL, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      command.inputTokens,
      command.outputTokens,
      command.cachedInputTokens,
      command.estimatedUsage ? 1 : 0,
      command.providerContinuation ? encodeModelProviderContinuation(command.providerContinuation) : null,
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
  const firstToolStepIndex = (previous?.max_index ?? 0) + 1;
  const resultItems: CommitToolProposalBatchResult['items'] = [];
  for (const [batchIndex, item] of command.items.entries()) {
    const toolStepId = randomUUID();
    const rejected = item.rejectedResult !== undefined;
    const safeRejectedResult = rejected ? (JSON.parse(JSON.stringify(item.rejectedResult)) as JsonValue) : null;
    await tx.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'tool', ?, ?, '[]', '[]', ?, ?)`,
      [
        toolStepId,
        command.runId,
        command.runtimeId,
        firstToolStepIndex + batchIndex,
        rejected ? 'failed' : 'created',
        row.input_revision,
        command.now,
        rejected ? command.now : null,
      ],
    );
    await tx.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, result_json, created_at, started_at, completed_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, 1)`,
      [
        item.toolCallId,
        command.runId,
        command.runtimeId,
        toolStepId,
        command.modelStepId,
        batchIndex,
        command.items.length,
        item.providerCallId,
        item.toolName,
        item.toolVersion,
        JSON.stringify(item.inspection),
        item.inspection.operationHash,
        item.inspection.risk,
        rejected ? 'failed' : 'proposed',
        safeRejectedResult === null ? null : JSON.stringify(safeRejectedResult),
        command.now,
        rejected ? command.now : null,
      ],
    );
    resultItems.push({ providerCallId: item.providerCallId, toolCallId: item.toolCallId, toolStepId });
  }
  const delegationChanged = await tx.execute(
    `UPDATE agent_delegations SET used_tokens = used_tokens + ?, used_steps = used_steps + ?,
     version = version + 1, updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND used_steps + ? <= max_steps`,
    [tokenDelta, command.items.length, command.now, command.delegationId, command.runId, command.items.length],
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
  const toolDeadlineAt = Math.min(delegation.deadline_at, command.now + runBudget.toolTimeoutSeconds);
  const executableItems = resultItems.filter((_, index) => command.items[index]?.rejectedResult === undefined);
  for (const item of executableItems) {
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
          toolStepId: item.toolStepId,
          toolCallId: item.toolCallId,
          sourceModelStepId: command.modelStepId,
        }),
        command.now,
        toolDeadlineAt,
        command.now,
        command.now,
      ],
    );
  }
  if (executableItems.length === 0) {
    await tx.execute(
      `INSERT INTO agent_scheduler_work
        (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
         deadline_at, created_at, updated_at, version)
       VALUES (?, ?, ?, 'model_step', 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
      [
        `work-${randomUUID()}`,
        command.runId,
        command.runtimeId,
        JSON.stringify({ delegationId: command.delegationId, cause: 'tool_batch_rejected' }),
        command.now,
        delegation.deadline_at,
        command.now,
        command.now,
      ],
    );
  }
  const events: DurableEventInput[] = [
    {
      type: 'model.completed',
      payload: {
        stepId: command.modelStepId,
        attemptId: command.attemptId,
        runtimeId: command.runtimeId,
        finishReason: command.finishReason ?? 'tool-calls',
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
      },
    },
    ...command.items.flatMap((item, batchIndex): DurableEventInput[] => [
      {
        type: 'tool.proposed',
        payload: {
          toolCallId: item.toolCallId,
          providerCallId: item.providerCallId,
          toolStepId: resultItems[batchIndex]!.toolStepId,
          toolName: item.toolName,
          operationHash: item.inspection.operationHash,
          risk: item.inspection.risk,
          runtimeId: command.runtimeId,
          batchIndex,
          batchSize: command.items.length,
        },
      },
      ...(item.rejectedResult
        ? [
            {
              type: 'tool.failed',
              payload: {
                toolCallId: item.toolCallId,
                toolStepId: resultItems[batchIndex]!.toolStepId,
                runtimeId: command.runtimeId,
                errorCode: item.rejectedResult.errorCode ?? 'SUBAGENT_TOOL_NOT_ALLOWED',
                summary: item.rejectedResult.summary,
              },
            } satisfies DurableEventInput,
          ]
        : []),
    ]),
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithDelta(row, {
    inputTokens: command.inputTokens,
    outputTokens: command.outputTokens,
    cachedInputTokens: command.cachedInputTokens,
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
    items: resultItems,
  };
};

export const beginSubagentMutationToolTransition = async (
  tx: RelationalDatabase,
  command: BeginSubagentMutationToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.status !== 'running') throw new Error('RUN_NOT_SCHEDULABLE');
  if (mapRunRow(row).definition.approvalMode !== 'full_access') {
    throw new Error('SUBAGENT_MUTATION_NOT_GOVERNED');
  }
  if (row.input_revision !== command.expectedInputRevision) throw new Error('APPROVAL_STALE');
  const app = await tx.queryOne<{ policy_revision: number }>(
    'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [row.user_id, row.app_id],
  );
  if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('APPROVAL_STALE');

  const work = await tx.queryOne<{ status: string; owner_epoch: number | null }>(
    `SELECT status, owner_epoch FROM agent_scheduler_work
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'tool_step'`,
    [command.workId, command.runId, command.runtimeId],
  );
  if (!work || work.status !== 'claimed' || work.owner_epoch !== command.ownerEpoch) {
    throw new Error('SCHEDULER_WORK_STALE');
  }
  const delegation = await tx.queryOne<{
    status: string;
    child_runtime_id: string;
    mutation_mode: string;
    deadline_at: number;
  }>('SELECT status, child_runtime_id, mutation_mode, deadline_at FROM agent_delegations WHERE id = ? AND run_id = ?', [
    command.delegationId,
    command.runId,
  ]);
  if (
    !delegation ||
    delegation.child_runtime_id !== command.runtimeId ||
    delegation.mutation_mode !== 'governed' ||
    !['running', 'waiting'].includes(delegation.status) ||
    delegation.deadline_at <= command.now
  ) {
    throw new Error(
      delegation?.mutation_mode === 'read-only' ? 'SUBAGENT_MUTATION_NOT_GOVERNED' : 'DELEGATION_STATE_CONFLICT',
    );
  }

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
  ) {
    throw new Error('APPROVAL_STALE');
  }
  const step = await tx.queryOne<{ status: string }>(
    "SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'tool'",
    [command.toolStepId, command.runId, command.runtimeId],
  );
  const tool = await tx.queryOne<{
    status: string;
    operation_hash: string;
    risk: string;
    inspection_json: string;
    version: number;
  }>(
    `SELECT status, operation_hash, risk, inspection_json, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ? AND agent_runtime_id = ?`,
    [command.toolCallId, command.runId, command.toolStepId, command.runtimeId],
  );
  if (
    !step ||
    step.status !== 'created' ||
    !tool ||
    tool.status !== 'ready' ||
    tool.operation_hash !== command.operationHash ||
    !['mutate', 'destructive'].includes(tool.risk)
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const persistedInspection = parseToolInspection(tool.inspection_json);
  if (
    persistedInspection.operationHash !== tool.operation_hash ||
    !governedSubagentWorkspaceMutation(persistedInspection, command.runId, command.runtimeId)
  ) {
    throw new Error('SUBAGENT_MUTATION_TARGET_FORBIDDEN');
  }

  const approvalChanged = await tx.execute(
    `UPDATE agent_approvals SET consumed_at = ?, version = version + 1
     WHERE id = ? AND status = 'approved' AND consumed_at IS NULL AND version = ? AND expires_at > ?`,
    [command.now, command.approvalId, approval.version, command.now],
  );
  const stepChanged = await tx.execute(
    "UPDATE agent_steps SET status = 'running' WHERE id = ? AND run_id = ? AND status = 'created'",
    [command.toolStepId, command.runId],
  );
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'running', started_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'ready' AND version = ?`,
    [command.now, command.toolCallId, command.runId, tool.version],
  );
  const runtimeChanged = await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'executing', updated_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state IN ('runnable','executing')`,
    [command.now, command.runtimeId, command.runId],
  );
  if (
    approvalChanged.changes !== 1 ||
    stepChanged.changes !== 1 ||
    toolChanged.changes !== 1 ||
    runtimeChanged.changes !== 1
  ) {
    throw new Error('APPROVAL_STALE');
  }

  const events: DurableEventInput[] = [
    { type: 'approval.consumed', payload: { approvalId: command.approvalId, toolCallId: command.toolCallId } },
    {
      type: 'tool.started',
      payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId, runtimeId: command.runtimeId },
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
