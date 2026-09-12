import { randomUUID } from 'node:crypto';
import type {
  AtomicSetRunGoal,
  DurableEventInput,
  SetRunGoalCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import { allocateHostEvent, appendEvents, IDEMPOTENCY_TTL_SECONDS, summaryPayload } from './transaction-primitives';

interface CommandRow {
  status: 'pending' | 'committed' | 'unknown';
  request_hash: string;
  response_json: string | null;
}

export const setRunGoalTransition = async (
  tx: RelationalDatabase,
  command: AtomicSetRunGoal,
): Promise<SetRunGoalCommitResult> => {
  const existing = await tx.queryOne<CommandRow>(
    `SELECT status, request_hash, response_json FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.goal.set' AND idempotency_key = ?`,
    [command.scope.userId, command.scope.appId, command.idempotencyKey],
  );
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    const row = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [command.runId, command.scope.userId, command.scope.appId],
    );
    if (!row) throw new Error('RECONCILIATION_REQUIRED');
    return { run: mapRunRow(row), replayed: true, shouldInterruptModel: false, shouldReschedule: false };
  }

  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (!['created', 'running', 'awaiting_approval', 'awaiting_budget'].includes(row.status))
    throw new Error('RUN_NOT_ACCEPTING_GOAL');

  const activeTool = await tx.queryOne<{ id: string }>(
    `SELECT id FROM agent_tool_calls
     WHERE run_id = ? AND status IN ('proposed','ready','running','reconciling','awaiting_approval')
     ORDER BY created_at, id LIMIT 1`,
    [row.id],
  );

  const streamingModel =
    row.status === 'running'
      ? await tx.queryOne<{ id: string }>(
          `SELECT a.id FROM agent_model_attempts a
           JOIN agent_steps s ON s.id = a.step_id
           WHERE s.run_id = ? AND s.kind = 'model' AND s.status = 'running' AND a.status = 'streaming'
           LIMIT 1`,
          [row.id],
        )
      : null;

  await tx.execute(
    `INSERT INTO agent_commands
      (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
       response_json, result_entity_id, generation, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, 'run.goal.set', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      command.scope.userId,
      command.scope.appId,
      command.idempotencyKey,
      command.requestHash,
      row.id,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );

  const goalRevision = row.goal_revision + 1;
  const events: DurableEventInput[] = [
    { type: 'goal.updated', payload: { text: command.text, revision: goalRevision } },
  ];
  await appendEvents(tx, row, events, command.now);
  const changed = await tx.execute(
    `UPDATE agent_runs SET goal_text = ?, goal_revision = ?, goal_updated_at = ?,
       goal_status = ?, verification_status = 'not_started',
       next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [
      command.text,
      goalRevision,
      command.now,
      row.status === 'created' ? 'unknown' : 'in_progress',
      events.length,
      command.now,
      row.id,
      row.user_id,
      row.app_id,
      row.version,
    ],
  );
  if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
  const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updatedRow) throw new Error('NOT_FOUND');
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);

  const response = { runId: row.id, goalRevision, runVersion: run.version };
  const completed = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 200, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.goal.set' AND idempotency_key = ? AND status = 'pending'`,
    [JSON.stringify(response), command.now, row.user_id, row.app_id, command.idempotencyKey],
  );
  if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return {
    run,
    replayed: false,
    shouldInterruptModel: Boolean(streamingModel),
    shouldReschedule: !streamingModel && !activeTool && ['created', 'running'].includes(run.status),
  };
};
