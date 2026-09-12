import { randomUUID } from 'node:crypto';
import type {
  AppendInputCommitResult,
  AtomicAppendInput,
  DurableEventInput,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunStatus } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import {
  allocateHostEvent,
  appendEvents,
  appendLedger,
  artifactForInput,
  IDEMPOTENCY_TTL_SECONDS,
  NON_TERMINAL,
  summaryPayload,
} from './transaction-primitives';

interface CommandRow {
  status: 'pending' | 'committed' | 'unknown';
  request_hash: string;
  response_json: string | null;
}

interface ThreadRow {
  next_sequence: number;
  version: number;
}

export const appendInputTransition = async (
  tx: RelationalDatabase,
  command: AtomicAppendInput,
): Promise<AppendInputCommitResult> => {
  const commandName = command.mode === 'interrupt' ? 'run.interrupt' : 'run.input';
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
    const response = JSON.parse(existing.response_json) as {
      inputId: string;
      sequence: number;
      runVersion: number;
    };
    const row = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [command.runId, command.scope.userId, command.scope.appId],
    );
    if (!row) throw new Error('RECONCILIATION_REQUIRED');
    return {
      ...response,
      run: mapRunRow(row),
      replayed: true,
      shouldInterruptModel: false,
      shouldReschedule: false,
    };
  }
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (!NON_TERMINAL.has(row.status) || row.status === 'cancelling') throw new Error('RUN_NOT_ACCEPTING_INPUT');
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
  if (command.mode === 'interrupt' && !streamingModel) throw new Error('RUN_NOT_STREAMING_MODEL');

  const waitingApproval =
    row.status === 'awaiting_approval'
      ? await tx.queryOne<{
          approval_id: string;
          tool_call_id: string;
          provider_call_id: string;
          step_id: string;
        }>(
          `SELECT a.id AS approval_id, a.tool_call_id, t.provider_call_id, t.step_id
           FROM agent_approvals a
           JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
           WHERE a.run_id = ? AND a.user_id = ? AND a.app_id = ? AND a.status = 'requested'
           ORDER BY a.requested_at, a.id LIMIT 1`,
          [row.id, row.user_id, row.app_id],
        )
      : null;
  if (row.status === 'awaiting_approval' && !waitingApproval) throw new Error('APPROVAL_STATE_INVALID');

  await tx.execute(
    `INSERT INTO agent_commands
      (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
       response_json, result_entity_id, generation, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      command.scope.userId,
      command.scope.appId,
      commandName,
      command.idempotencyKey,
      command.requestHash,
      command.inputEntryId,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );
  const thread = await tx.queryOne<ThreadRow>(
    'SELECT next_sequence, version FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?',
    [row.thread_id, row.user_id, row.app_id],
  );
  if (!thread) throw new Error('NOT_FOUND');
  const sequence = thread.next_sequence;
  for (const artifactId of command.input.artifactRefs) {
    await artifactForInput(
      tx,
      command.scope.userId,
      command.scope.appId,
      row.thread_id,
      command.runId,
      artifactId,
      command.now,
    );
    await tx.execute(
      `INSERT OR IGNORE INTO agent_artifact_links (artifact_id, run_id, role, created_at) VALUES (?, ?, 'input', ?)`,
      [artifactId, command.runId, command.now],
    );
  }
  await tx.execute(
    `INSERT INTO ai_thread_entries
      (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'user_input', ?, ?)`,
    [
      command.inputEntryId,
      row.thread_id,
      row.user_id,
      row.app_id,
      row.id,
      sequence,
      JSON.stringify(command.input),
      command.now,
    ],
  );
  const threadChanged = await tx.execute(
    `UPDATE ai_threads SET next_sequence = next_sequence + 1, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [command.now, row.thread_id, row.user_id, row.app_id, thread.version],
  );
  if (threadChanged.changes !== 1) throw new Error('STATE_CONFLICT');
  if (waitingApproval) {
    const approvalChanged = await tx.execute(
      `UPDATE agent_approvals SET status = 'superseded', decided_at = ?, version = version + 1
       WHERE id = ? AND status = 'requested'`,
      [command.now, waitingApproval.approval_id],
    );
    const toolChanged = await tx.execute(
      `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
       WHERE id = ? AND run_id = ? AND status = 'awaiting_approval'`,
      [command.now, waitingApproval.tool_call_id, row.id],
    );
    const stepChanged = await tx.execute(
      `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
       WHERE id = ? AND run_id = ? AND status = 'created'`,
      [command.now, waitingApproval.step_id, row.id],
    );
    if (approvalChanged.changes !== 1 || toolChanged.changes !== 1 || stepChanged.changes !== 1) {
      throw new Error('APPROVAL_STALE');
    }
    await appendLedger(
      tx,
      row,
      [
        {
          id: randomUUID(),
          runId: row.id,
          kind: 'tool_result',
          payload: {
            toolCallId: waitingApproval.provider_call_id,
            text: JSON.stringify({
              ok: false,
              outcome: 'confirmed',
              errorCode: 'APPROVAL_SUPERSEDED',
              summary: 'A newer user input superseded the pending approval.',
            }),
          },
        },
      ],
      command.now,
    );
    await tx.execute(
      `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ?
       WHERE user_id = ? AND app_id = ?`,
      [command.now, row.user_id, row.app_id],
    );
  }
  const nextStatus: RunStatus = waitingApproval ? 'running' : row.status;
  const events: DurableEventInput[] = [
    {
      type: 'input.appended',
      payload: { inputId: command.inputEntryId, sequence, inputRevision: row.input_revision + 1 },
    },
    ...(waitingApproval
      ? [
          {
            type: 'approval.superseded',
            payload: {
              approvalId: waitingApproval.approval_id,
              toolCallId: waitingApproval.tool_call_id,
              reason: 'new_input',
            },
          },
          { type: 'run.status_changed', payload: { from: 'awaiting_approval', to: 'running' } },
        ]
      : []),
  ];
  await appendEvents(tx, row, events, command.now);
  const runChanged = await tx.execute(
    `UPDATE agent_runs SET status = ?, input_revision = input_revision + 1,
       next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [nextStatus, events.length, command.now, row.id, row.user_id, row.app_id, row.version],
  );
  if (runChanged.changes !== 1) throw new Error('STATE_CONFLICT');
  const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updatedRow) throw new Error('NOT_FOUND');
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);
  const response = { inputId: command.inputEntryId, sequence, runVersion: run.version };
  const completed = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 202, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = ? AND idempotency_key = ? AND status = 'pending'`,
    [JSON.stringify(response), command.now, row.user_id, row.app_id, commandName, command.idempotencyKey],
  );
  if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return {
    ...response,
    run,
    replayed: false,
    shouldInterruptModel: Boolean(streamingModel),
    shouldReschedule: Boolean(waitingApproval),
  };
};
