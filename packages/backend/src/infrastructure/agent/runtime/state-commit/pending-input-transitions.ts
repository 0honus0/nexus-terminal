import { randomUUID } from 'node:crypto';
import type {
  AtomicMutatePendingInput,
  MutatePendingInputCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { projectRunUserInputs } from '../../repositories/run-input-projection';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import {
  allocateHostEvent,
  appendEvents,
  IDEMPOTENCY_TTL_SECONDS,
  NON_TERMINAL,
  summaryPayload,
} from './transaction-primitives';

interface CommandRow {
  status: 'pending' | 'committed' | 'unknown';
  request_hash: string;
  response_json: string | null;
}

const idsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const mutatePendingInputTransition = async (
  tx: RelationalDatabase,
  command: AtomicMutatePendingInput,
): Promise<MutatePendingInputCommitResult> => {
  const commandName = `run.pending_input.${command.action}`;
  const existing = await tx.queryOne<CommandRow>(
    `SELECT status, request_hash, response_json FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = ? AND idempotency_key = ?`,
    [command.scope.userId, command.scope.appId, commandName, command.idempotencyKey],
  );
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    if (!existing.response_json) throw new Error('IDEMPOTENCY_RESPONSE_MISSING');
    const row = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [command.runId, command.scope.userId, command.scope.appId],
    );
    if (!row) throw new Error('RECONCILIATION_REQUIRED');
    return { run: mapRunRow(row), replayed: true, shouldInterruptModel: false };
  }

  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (!NON_TERMINAL.has(row.status) || row.status === 'cancelling') throw new Error('RUN_NOT_ACCEPTING_INPUT');

  const projected = await projectRunUserInputs(tx, command.scope, row.id);
  const pending = projected.filter((entry) => entry.sequence > row.consumed_input_sequence);
  const currentIds = pending.map((entry) => entry.id);
  if (!currentIds.includes(command.inputId)) throw new Error('PENDING_INPUT_NOT_FOUND');

  let desiredIds: string[];
  if (command.action === 'remove') {
    if (command.beforeInputId !== null) throw new Error('VALIDATION_FAILED');
    desiredIds = currentIds.filter((id) => id !== command.inputId);
    if (desiredIds.length === 0 && !projected.some((entry) => entry.sequence <= row.consumed_input_sequence)) {
      throw new Error('PENDING_INPUT_REQUIRED');
    }
  } else {
    if (command.beforeInputId === command.inputId) throw new Error('PENDING_INPUT_NO_CHANGE');
    const withoutSource = currentIds.filter((id) => id !== command.inputId);
    if (command.beforeInputId === null) {
      desiredIds = [...withoutSource, command.inputId];
    } else {
      const targetIndex = withoutSource.indexOf(command.beforeInputId);
      if (targetIndex < 0) throw new Error('PENDING_INPUT_NOT_FOUND');
      desiredIds = [...withoutSource.slice(0, targetIndex), command.inputId, ...withoutSource.slice(targetIndex)];
    }
  }
  if (idsEqual(currentIds, desiredIds)) throw new Error('PENDING_INPUT_NO_CHANGE');

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
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      row.user_id,
      row.app_id,
      commandName,
      command.idempotencyKey,
      command.requestHash,
      command.inputId,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );

  const events = await appendEvents(
    tx,
    row,
    [
      {
        type: command.action === 'remove' ? 'input.pending_removed' : 'input.pending_moved',
        payload: {
          inputId: command.inputId,
          beforeInputId: command.beforeInputId,
          inputRevision: row.input_revision + 1,
        },
      },
    ],
    command.now,
  );
  const runChanged = await tx.execute(
    `UPDATE agent_runs SET input_revision = input_revision + 1,
       next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [events.length, command.now, row.id, row.user_id, row.app_id, row.version],
  );
  if (runChanged.changes !== 1) throw new Error('STATE_CONFLICT');
  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);
  const response = { runVersion: run.version };
  const completed = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 200, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = ? AND idempotency_key = ? AND status = 'pending'`,
    [JSON.stringify(response), command.now, row.user_id, row.app_id, commandName, command.idempotencyKey],
  );
  if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return { run, replayed: false, shouldInterruptModel: Boolean(streamingModel) };
};
