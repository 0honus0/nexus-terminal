import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type {
  AtomicCancelRun,
  AtomicCreateRun,
  AtomicDeleteRun,
  AtomicIncreaseRunBudget,
  CancelRunCommitResult,
  CreateRunCommitResult,
  DeleteRunCommitResult,
  DurableEventInput,
  IncreaseRunBudgetCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunBudget, RunStatus } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import {
  allocateHostEvent,
  appendEvents,
  appendLedger,
  artifactForInput,
  cancelRunSubagentWork,
  COUNTED_LIVE,
  CREATED_QUEUE_LIMIT,
  emptyUsage,
  IDEMPOTENCY_TTL_SECONDS,
  NON_TERMINAL,
  summaryPayload,
  updateAppLiveCount,
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

interface AppPolicyRow {
  policy_revision: number;
  desired_state: string;
}

export const createRunTransition = async (
  tx: RelationalDatabase,
  command: AtomicCreateRun,
): Promise<CreateRunCommitResult> => {
  const existing = await tx.queryOne<CommandRow>(
    `SELECT status, request_hash, response_json FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.create' AND idempotency_key = ?`,
    [command.scope.userId, command.scope.appId, command.idempotencyKey],
  );
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    if (!existing.response_json) throw new Error('IDEMPOTENCY_RESPONSE_MISSING');
    const response = JSON.parse(existing.response_json) as { runId: string; inputSequence: number };
    const row = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [response.runId, command.scope.userId, command.scope.appId],
    );
    if (!row) throw new Error('RECONCILIATION_REQUIRED');
    return { run: mapRunRow(row), inputSequence: response.inputSequence, replayed: true };
  }

  const app = await tx.queryOne<AppPolicyRow>(
    'SELECT policy_revision, desired_state FROM agent_apps WHERE user_id = ? AND app_id = ?',
    [command.scope.userId, command.scope.appId],
  );
  if (!app || app.desired_state !== 'enabled') throw new Error('AGENT_APP_DISABLED');
  if (app.policy_revision !== command.expectedPolicyRevision) throw new Error('POLICY_REVISION_CONFLICT');
  const thread = await tx.queryOne<ThreadRow>(
    'SELECT next_sequence, version FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?',
    [command.threadId, command.scope.userId, command.scope.appId],
  );
  if (!thread) throw new Error('NOT_FOUND');
  const live = await tx.queryOne<{ id: string }>(
    `SELECT id FROM agent_runs WHERE thread_id = ?
     AND status IN ('created','running','awaiting_approval','awaiting_budget','cancelling') LIMIT 1`,
    [command.threadId],
  );
  if (live) throw new Error('THREAD_HAS_ACTIVE_RUN');
  const queue = await tx.queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM agent_runs WHERE status = 'created'",
  );
  if ((queue?.count ?? 0) >= CREATED_QUEUE_LIMIT) throw new Error('RUN_QUEUE_FULL');

  await tx.execute(
    `INSERT INTO agent_commands
      (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
       response_json, result_entity_id, generation, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, 'run.create', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      command.scope.userId,
      command.scope.appId,
      command.idempotencyKey,
      command.requestHash,
      command.runId,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );

  const inputSequence = thread.next_sequence;
  await tx.execute(
    `INSERT INTO agent_runs (
      id, user_id, app_id, thread_id, parent_run_id, status, goal_status,
      goal_text, goal_revision, goal_updated_at, verification_status,
      needs_reconciliation, budget_json, definition_json, plan_json, usage_json,
      active_execution_seconds, active_execution_started_at, executing_runtime_count,
      next_event_sequence, consumed_input_sequence, input_revision, version,
      created_at, started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'created', 'unknown', ?, ?, ?, 'not_started', 0, ?, ?, ?, ?, 0, NULL, 0, 2, 0, 1, 1, ?, NULL, NULL, ?)`,
    [
      command.runId,
      command.scope.userId,
      command.scope.appId,
      command.threadId,
      command.parentRunId ?? null,
      command.initialGoal?.text ?? null,
      command.initialGoal?.revision ?? 0,
      command.initialGoal?.updatedAt ?? null,
      JSON.stringify(command.budget),
      JSON.stringify(command.definition),
      JSON.stringify(command.initialPlan ?? { schemaVersion: 1, revision: 0, items: [] }),
      JSON.stringify(emptyUsage()),
      command.now,
      command.now,
    ],
  );
  await tx.execute(
    `INSERT INTO agent_runtimes
      (id, run_id, participant_id, backend_kind, model_ref_json, status, execution_owner_id, created_at, updated_at)
     VALUES (?, ?, 'root', 'native', ?, 'created', ?, ?, ?)`,
    [command.runtimeId, command.runId, JSON.stringify(command.model), command.runtimeId, command.now, command.now],
  );
  const initialEntry = command.initialEntry ?? {
    kind: 'user_input' as const,
    payload: command.input as unknown as JsonValue,
    artifactRefs: command.input.artifactRefs,
  };
  await tx.execute(
    `INSERT INTO ai_thread_entries
      (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      command.inputEntryId,
      command.threadId,
      command.scope.userId,
      command.scope.appId,
      command.runId,
      inputSequence,
      initialEntry.kind,
      JSON.stringify(initialEntry.payload),
      command.now,
    ],
  );
  const threadUpdated = await tx.execute(
    `UPDATE ai_threads SET next_sequence = next_sequence + 1, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [command.now, command.threadId, command.scope.userId, command.scope.appId, thread.version],
  );
  if (threadUpdated.changes !== 1) throw new Error('STATE_CONFLICT');
  for (const artifactId of initialEntry.artifactRefs) {
    await artifactForInput(
      tx,
      command.scope.userId,
      command.scope.appId,
      command.threadId,
      command.runId,
      artifactId,
      command.now,
    );
    await tx.execute(
      `INSERT OR IGNORE INTO agent_artifact_links (artifact_id, run_id, role, created_at) VALUES (?, ?, 'input', ?)`,
      [artifactId, command.runId, command.now],
    );
  }
  const runCreatedPayload: JsonValue = {
    runId: command.runId,
    threadId: command.threadId,
    inputSequence,
    agentDefinitionId: command.agentDefinitionId,
    ...(command.initialGoal
      ? {
          initialGoal: {
            text: command.initialGoal.text,
            revision: command.initialGoal.revision,
            updatedAt: command.initialGoal.updatedAt,
          },
        }
      : {}),
  };
  await tx.execute(
    `INSERT INTO agent_events (event_id, run_id, sequence, schema_version, type, payload_json, occurred_at)
     VALUES (?, ?, 1, 1, 'run.created', ?, ?)`,
    [randomUUID(), command.runId, JSON.stringify(runCreatedPayload), command.now],
  );
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  const run = mapRunRow(row);
  await allocateHostEvent(tx, command.scope.userId, 'summary.changed', summaryPayload(run), command.now);
  const responseJson = JSON.stringify({ runId: command.runId, inputSequence });
  const completed = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 201, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.create' AND idempotency_key = ? AND status = 'pending'`,
    [responseJson, command.now, command.scope.userId, command.scope.appId, command.idempotencyKey],
  );
  if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return { run, inputSequence, replayed: false };
};

export const cancelRunTransition = async (
  tx: RelationalDatabase,
  command: AtomicCancelRun,
): Promise<CancelRunCommitResult> => {
  const existing = await tx.queryOne<CommandRow>(
    `SELECT status, request_hash, response_json FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.cancel' AND idempotency_key = ?`,
    [command.scope.userId, command.scope.appId, command.idempotencyKey],
  );
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    const response = existing.response_json
      ? (JSON.parse(existing.response_json) as { accepted: boolean })
      : { accepted: false };
    const row = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [command.runId, command.scope.userId, command.scope.appId],
    );
    if (!row) throw new Error('RECONCILIATION_REQUIRED');
    return { run: mapRunRow(row), accepted: response.accepted, replayed: true };
  }
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  await tx.execute(
    `INSERT INTO agent_commands
      (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
       response_json, result_entity_id, generation, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, 'run.cancel', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      row.user_id,
      row.app_id,
      command.idempotencyKey,
      command.requestHash,
      row.id,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );
  let accepted = false;
  let updatedRow = row;
  if (NON_TERMINAL.has(row.status)) {
    accepted = true;
    const immediate = row.executing_runtime_count === 0 || (row.status !== 'running' && row.status !== 'cancelling');
    const nextStatus: RunStatus = immediate ? 'cancelled' : 'cancelling';
    if (row.status === 'awaiting_approval') {
      const approvalsChanged = await tx.execute(
        `UPDATE agent_approvals SET status = 'superseded', decided_at = ?, version = version + 1
         WHERE run_id = ? AND user_id = ? AND app_id = ? AND status = 'requested'`,
        [command.now, row.id, row.user_id, row.app_id],
      );
      await tx.execute(
        `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
         WHERE run_id = ? AND status = 'awaiting_approval'`,
        [command.now, row.id],
      );
      await tx.execute(
        `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
         WHERE run_id = ? AND kind = 'tool' AND status = 'created'`,
        [command.now, row.id],
      );
      if (approvalsChanged.changes > 0) {
        await tx.execute(
          `UPDATE agent_apps SET approval_count = MAX(0, approval_count - ?), updated_at = ?
           WHERE user_id = ? AND app_id = ?`,
          [approvalsChanged.changes, command.now, row.user_id, row.app_id],
        );
      }
    }
    const events: DurableEventInput[] = [
      { type: 'run.cancel_requested', payload: { previousStatus: row.status } },
      ...(immediate ? [{ type: 'run.cancelled', payload: { reason: 'no_active_participants' } } as const] : []),
      { type: 'run.status_changed', payload: { from: row.status, to: nextStatus } },
    ];
    await cancelRunSubagentWork(tx, row.id, command.now, immediate);
    await appendEvents(tx, row, events, command.now);
    const changed = await tx.execute(
      `UPDATE agent_runs SET status = ?, completed_at = ?, executing_runtime_count = ?,
         active_execution_started_at = CASE WHEN ? = 'cancelled' THEN NULL ELSE active_execution_started_at END,
         next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
      [
        nextStatus,
        immediate ? command.now : null,
        immediate ? 0 : row.executing_runtime_count,
        nextStatus,
        events.length,
        command.now,
        row.id,
        row.user_id,
        row.app_id,
        row.version,
      ],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
    if (immediate) {
      await tx.execute(
        `UPDATE agent_runtimes SET status = 'stopped', schedule_state = 'finished', updated_at = ?
         WHERE run_id = ? AND status IN ('created','running','stopping','interrupted')`,
        [command.now, row.id],
      );
      if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
    }
    const selected = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
    if (!selected) throw new Error('NOT_FOUND');
    updatedRow = selected;
    await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(mapRunRow(updatedRow)), command.now);
  }
  const response = { accepted };
  const completed = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = ?, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.cancel' AND idempotency_key = ? AND status = 'pending'`,
    [accepted ? 202 : 200, JSON.stringify(response), command.now, row.user_id, row.app_id, command.idempotencyKey],
  );
  if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return { run: mapRunRow(updatedRow), accepted, replayed: false };
};

export const increaseRunBudgetTransition = async (
  tx: RelationalDatabase,
  command: AtomicIncreaseRunBudget,
): Promise<IncreaseRunBudgetCommitResult> => {
  const existing = await tx.queryOne<CommandRow>(
    `SELECT status, request_hash, response_json FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.budget' AND idempotency_key = ?`,
    [command.scope.userId, command.scope.appId, command.idempotencyKey],
  );
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    if (!existing.response_json) throw new Error('IDEMPOTENCY_RESPONSE_MISSING');
    const response = JSON.parse(existing.response_json) as { runId: string };
    const row = await tx.queryOne<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
      [response.runId, command.scope.userId, command.scope.appId],
    );
    if (!row) throw new Error('RECONCILIATION_REQUIRED');
    return { run: mapRunRow(row), replayed: true };
  }

  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (row.status !== 'awaiting_budget') throw new Error('RUN_NOT_AWAITING_BUDGET');

  await tx.execute(
    `INSERT INTO agent_commands
      (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
       response_json, result_entity_id, generation, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, 'run.budget', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      row.user_id,
      row.app_id,
      command.idempotencyKey,
      command.requestHash,
      row.id,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );

  const nextStatus: RunStatus = row.started_at === null ? 'created' : 'running';
  const events: DurableEventInput[] = [
    {
      type: 'budget.increased',
      payload: { budget: JSON.parse(JSON.stringify(command.budget)) as JsonValue },
    },
    { type: 'run.status_changed', payload: { from: 'awaiting_budget', to: nextStatus } },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const changed = await tx.execute(
    `UPDATE agent_runs SET budget_json = ?, status = ?, next_event_sequence = next_event_sequence + ?,
       version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'awaiting_budget'`,
    [
      JSON.stringify(command.budget),
      nextStatus,
      events.length,
      command.now,
      row.id,
      row.user_id,
      row.app_id,
      row.version,
    ],
  );
  if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
  await tx.execute(
    `UPDATE agent_apps SET budget_request_count = MAX(0, budget_request_count - 1), updated_at = ?
     WHERE user_id = ? AND app_id = ?`,
    [command.now, row.user_id, row.app_id],
  );
  await tx.execute(
    `UPDATE agent_runtimes SET schedule_state = CASE
       WHEN schedule_state = 'waiting_budget' THEN 'runnable' ELSE schedule_state END,
       updated_at = ? WHERE run_id = ?`,
    [command.now, row.id],
  );
  if (nextStatus === 'created') await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);

  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);
  const responseJson = JSON.stringify({ runId: run.id });
  const completed = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 200, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.budget' AND idempotency_key = ? AND status = 'pending'`,
    [responseJson, command.now, row.user_id, row.app_id, command.idempotencyKey],
  );
  if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  void committedEvents;
  return { run, replayed: false };
};

export const deleteRunTransition = async (
  tx: RelationalDatabase,
  command: AtomicDeleteRun,
): Promise<DeleteRunCommitResult> => {
  const existing = await tx.queryOne<CommandRow>(
    `SELECT status, request_hash, response_json FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.delete' AND idempotency_key = ?`,
    [command.scope.userId, command.scope.appId, command.idempotencyKey],
  );
  if (existing) {
    if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
    if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
    if (!existing.response_json) throw new Error('IDEMPOTENCY_RESPONSE_MISSING');
    const response = JSON.parse(existing.response_json) as { runId: string; hostEventCursor: number };
    return { runId: response.runId, deleted: true, replayed: true, hostEventCursor: response.hostEventCursor };
  }

  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (NON_TERMINAL.has(row.status)) throw new Error('RUN_DELETE_ACTIVE');
  if (row.needs_reconciliation === 1) throw new Error('RUN_DELETE_RECONCILIATION_REQUIRED');
  const workspace = await tx.queryOne<{ id: string }>(
    `SELECT id FROM agent_workspaces
     WHERE run_id = ? AND user_id = ? AND app_id = ? AND (status <> 'deleted' OR retained = 1) LIMIT 1`,
    [row.id, row.user_id, row.app_id],
  );
  if (workspace) throw new Error('RUN_DELETE_WORKSPACE_ATTACHED');
  const child = await tx.queryOne<{ id: string }>(
    `SELECT id FROM agent_runs
     WHERE parent_run_id = ? AND user_id = ? AND app_id = ? LIMIT 1`,
    [row.id, row.user_id, row.app_id],
  );
  if (child) throw new Error('RUN_DELETE_REFERENCED');

  await tx.execute(
    `INSERT INTO agent_commands
      (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
       response_json, result_entity_id, generation, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, 'run.delete', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
    [
      randomUUID(),
      row.user_id,
      row.app_id,
      command.idempotencyKey,
      command.requestHash,
      row.id,
      command.now,
      command.now + IDEMPOTENCY_TTL_SECONDS,
    ],
  );

  await tx.execute('DELETE FROM agent_artifact_grants WHERE receiver_run_id = ?', [row.id]);
  await tx.execute('DELETE FROM agent_artifact_links WHERE run_id = ?', [row.id]);
  await tx.execute('DELETE FROM ai_thread_entries WHERE run_id = ? AND user_id = ? AND app_id = ?', [
    row.id,
    row.user_id,
    row.app_id,
  ]);
  await tx.execute('DELETE FROM ai_context_digests WHERE thread_id = ?', [row.thread_id]);
  const deleted = await tx.execute(
    `DELETE FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [row.id, row.user_id, row.app_id, row.version],
  );
  if (deleted.changes !== 1) throw new Error('STATE_CONFLICT');

  const hostEventCursor = await allocateHostEvent(
    tx,
    row.user_id,
    'summary.changed',
    { appId: row.app_id, runId: row.id, threadId: row.thread_id, deleted: true },
    command.now,
  );
  const responseJson = JSON.stringify({ runId: row.id, hostEventCursor });
  const completed = await tx.execute(
    `UPDATE agent_commands SET status = 'committed', response_status = 202, response_json = ?, completed_at = ?
     WHERE user_id = ? AND app_id = ? AND command_name = 'run.delete' AND idempotency_key = ? AND status = 'pending'`,
    [responseJson, command.now, row.user_id, row.app_id, command.idempotencyKey],
  );
  if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
  return { runId: row.id, deleted: true, replayed: false, hostEventCursor };
};
