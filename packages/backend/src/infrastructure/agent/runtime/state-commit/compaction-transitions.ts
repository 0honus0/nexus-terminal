import type {
  CompleteCompactionStepCommand,
  CompleteCompactionStepResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { SqliteContextCheckpointRepository } from '../../repositories/sqlite-context-checkpoint.repository';
import { SqliteConversationRepository } from '../../repositories/sqlite-conversation.repository';
import {
  checkpointSourceHash,
  checkpointVisibilityHash,
} from '../../../../modules/agent/ai/context-checkpoint.service';
import { projectRunUserInputs } from '../../repositories/run-input-projection';
import { RUN_COLUMNS, mapRunRow, type RunRow } from '../../repositories/sqlite-run.mapper';
import { allocateHostEvent, appendEvents, patchRun, summaryPayload, usageWithDelta } from './transaction-primitives';

export const completeCompactionStepTransition = async (
  tx: RelationalDatabase,
  command: CompleteCompactionStepCommand,
): Promise<CompleteCompactionStepResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id WHERE a.id = ? AND s.id = ? AND s.run_id = ? AND s.agent_runtime_id = ? AND s.status = 'running'`,
    [command.attemptId, command.stepId, command.runId, command.runtimeId],
  );
  if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');
  let errorCode = command.errorCode;
  if (
    row.input_revision !== command.inputWatermark ||
    row.goal_revision !== command.goalRevision ||
    row.status !== 'running'
  )
    errorCode = 'CONTEXT_COMPACTION_SUPERSEDED';
  if (command.checkpoint && !errorCode) {
    const checkpoint = command.checkpoint;
    if (
      checkpoint.scope.userId !== row.user_id ||
      checkpoint.scope.appId !== row.app_id ||
      checkpoint.threadId !== row.thread_id
    )
      throw new Error('STATE_CONFLICT');
    const visibility = checkpoint.visibility;
    const entries = await new SqliteConversationRepository(tx).readVisibleEntriesThrough(
      command.scope,
      row.thread_id,
      checkpoint.toSequence,
      visibility.kind === 'run_boundary' ? visibility.runId : undefined,
      visibility.kind === 'run_boundary' ? visibility.historyBoundary : undefined,
    );
    const projectedRunIds = [
      row.id,
      ...Object.keys(visibility.kind === 'run_boundary' ? visibility.historyBoundary.runThrough : {}),
    ];
    const effectiveInputs = new Map<string, string>();
    for (const runId of projectedRunIds)
      for (const entry of await projectRunUserInputs(tx, command.scope, runId))
        effectiveInputs.set(entry.id, entry.text);
    if (
      checkpoint.sourceHash !== checkpointSourceHash(entries) ||
      checkpoint.visibilityHash !== checkpointVisibilityHash(visibility, entries, effectiveInputs, projectedRunIds)
    )
      errorCode = 'CONTEXT_COMPACTION_SOURCE_CHANGED';
    else await new SqliteContextCheckpointRepository(tx).upsert(checkpoint);
  }
  await tx.execute(
    `UPDATE agent_model_attempts SET status = ?, input_tokens = ?, output_tokens = ?, cached_input_tokens = ?, estimated = ?, error_code = ?, completed_at = ? WHERE id = ? AND status = 'streaming'`,
    [
      errorCode ? 'failed' : 'completed',
      command.inputTokens,
      command.outputTokens,
      command.cachedInputTokens,
      command.estimatedUsage ? 1 : 0,
      errorCode ?? null,
      command.now,
      command.attemptId,
    ],
  );
  await tx.execute(`UPDATE agent_steps SET status = ?, completed_at = ? WHERE id = ?`, [
    errorCode ? 'failed' : 'completed',
    command.now,
    command.stepId,
  ]);
  await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = 'runnable', updated_at = ? WHERE id = ? AND status = 'running'`,
    [command.now, command.runtimeId],
  );
  const nextExecuting = Math.max(0, row.executing_runtime_count - 1);
  const activeDelta =
    row.executing_runtime_count <= 1 && row.active_execution_started_at !== null
      ? Math.max(0, command.now - row.active_execution_started_at)
      : 0;
  await tx.execute(
    `UPDATE agent_runs SET executing_runtime_count = ?, active_execution_seconds = active_execution_seconds + ?, active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END WHERE id = ?`,
    [nextExecuting, activeDelta, nextExecuting, row.id],
  );
  const events = [
    {
      type: errorCode ? ('model.failed' as const) : ('model.completed' as const),
      payload: {
        stepId: command.stepId,
        attemptId: command.attemptId,
        purpose: 'compaction',
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
        ...(errorCode ? { code: errorCode } : {}),
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updated = await patchRun(
    tx,
    row,
    {
      usage: usageWithDelta(row, {
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
        cachedInputTokens: command.cachedInputTokens,
        steps: 1,
      }),
    },
    events.length,
    command.now,
  );
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return {
    run,
    eventCursor: run.eventCursor,
    ledgerCursor: 0,
    committedEvents,
    ...(errorCode ? { compactionErrorCode: errorCode } : {}),
  };
};
