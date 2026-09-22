import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type {
  BeginSubagentMutationToolCommand,
  BeginSubagentToolCommand,
  CommitSubagentToolProposalBatchCommand,
  CommitToolProposalBatchResult,
  DurableEventInput,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import { encodeModelProviderContinuation } from '../../../../modules/agent/ai/model-continuation';
import { governedSubagentWorkspaceMutation } from '../../../../modules/agent/runtime/collaboration/subagent-mutation-policy';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS } from '../../repositories/sqlite-run.mapper';
import type { RunRow } from '../../repositories/sqlite-run.mapper';
import { parseRunBudget, parseRunUsage, parseToolInspection } from '../durable-state-decoders';
import { allocateHostEvent, appendEvents, summaryPayload, usageWithDelta } from './transaction-primitives';

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
