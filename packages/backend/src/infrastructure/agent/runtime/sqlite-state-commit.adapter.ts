import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../modules/agent/agent.types';
import type {
  AppendInputCommitResult,
  AtomicAppendInput,
  AtomicCancelRun,
  AtomicCreateRun,
  AtomicDeleteRun,
  AtomicIncreaseRunBudget,
  BeginModelStepCommand,
  BeginModelStepResult,
  BeginSubagentModelStepCommand,
  BeginSubagentToolCommand,
  SettleSubagentModelStepCommand,
  SettleSubagentToolCommand,
  SettleSubagentWithoutModelCommand,
  BeginReadToolCommand,
  BeginMutationToolCommand,
  CancelRunCommitResult,
  CommitSubagentToolProposalCommand,
  CommitToolProposalCommand,
  CommitToolProposalResult,
  CreateRunCommitResult,
  DeleteRunCommitResult,
  DurableEventInput,
  IncreaseRunBudgetCommitResult,
  LedgerAppendInput,
  PauseModelStepForBudgetCommand,
  PauseRuntimeForBudgetCommand,
  ParkModelStepCommand,
  ParkRuntimeCommand,
  RetryModelStepCommand,
  RetryModelStepResult,
  RequestToolApprovalCommand,
  ResolveToolApprovalCommand,
  RunProjectionPatch,
  SettleModelStepCommand,
  SettleReadToolCommand,
  SettleMutationToolCommand,
  StateCommitCommand,
  StateCommitPort,
  StateCommitResult,
  SupersedeModelStepCommand,
  SupersedeMutationToolCommand,
} from '../../../modules/agent/runtime/runs/state-commit.port';
import type { RunBudget, RunEvent, RunStatus, RunUsage, RunView } from '../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../repositories/sqlite-run.mapper';

const NON_TERMINAL = new Set<RunStatus>(['created', 'running', 'awaiting_approval', 'awaiting_budget', 'cancelling']);
const COUNTED_LIVE = new Set<RunStatus>(['running', 'awaiting_approval', 'awaiting_budget', 'cancelling']);
const MAX_EVENTS_PER_COMMIT = 64;
const MAX_EVENT_BYTES_PER_COMMIT = 256 * 1024;
const CREATED_QUEUE_LIMIT = 20;
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

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

interface ArtifactRow {
  status: string;
  app_id: string;
}

const eventBytes = (events: readonly DurableEventInput[]): number =>
  events.reduce(
    (total, event) =>
      total + Buffer.byteLength(event.type, 'utf8') + Buffer.byteLength(JSON.stringify(event.payload), 'utf8'),
    0,
  );

const validateEvents = (events: readonly DurableEventInput[]): void => {
  if (events.length > MAX_EVENTS_PER_COMMIT || eventBytes(events) > MAX_EVENT_BYTES_PER_COMMIT) {
    throw new Error('AGENT_COMMIT_BATCH_TOO_LARGE');
  }
};

const emptyUsage = (): RunUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  costMicros: 0,
  steps: 0,
  subagentMessages: 0,
  subagentMessageBytes: 0,
});

const usageWithDelta = (
  row: RunRow,
  delta: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
    costMicros?: number | null;
    steps?: number;
  },
): RunUsage => {
  const current = JSON.parse(row.usage_json) as RunUsage;
  return {
    inputTokens: current.inputTokens + (delta.inputTokens ?? 0),
    outputTokens: current.outputTokens + (delta.outputTokens ?? 0),
    cachedInputTokens: current.cachedInputTokens + (delta.cachedInputTokens ?? 0),
    costMicros: current.costMicros + (delta.costMicros ?? 0),
    steps: current.steps + (delta.steps ?? 0),
    subagentMessages: current.subagentMessages ?? 0,
    subagentMessageBytes: current.subagentMessageBytes ?? 0,
  };
};

const summaryPayload = (run: RunView): JsonValue => ({
  appId: run.appId,
  runId: run.id,
  threadId: run.threadId,
  status: run.status,
  goalStatus: run.goalStatus,
  verificationStatus: run.verificationStatus,
  needsReconciliation: run.needsReconciliation,
  version: run.version,
  updatedAt: run.updatedAt,
});

const allocateHostEvent = async (
  tx: RelationalDatabase,
  userId: number,
  type: string,
  payload: JsonValue,
  occurredAt: number,
): Promise<number> => {
  await tx.execute('INSERT OR IGNORE INTO agent_host_cursors (user_id, next_sequence) VALUES (?, 1)', [userId]);
  const cursor = await tx.queryOne<{ next_sequence: number }>(
    'SELECT next_sequence FROM agent_host_cursors WHERE user_id = ?',
    [userId],
  );
  if (!cursor) throw new Error('HOST_CURSOR_UNAVAILABLE');
  const sequence = cursor.next_sequence;
  const advanced = await tx.execute(
    'UPDATE agent_host_cursors SET next_sequence = next_sequence + 1 WHERE user_id = ? AND next_sequence = ?',
    [userId, sequence],
  );
  if (advanced.changes !== 1) throw new Error('STATE_CONFLICT');
  await tx.execute(
    'INSERT INTO agent_host_events (user_id, sequence, type, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?)',
    [userId, sequence, type, JSON.stringify(payload), occurredAt],
  );
  return sequence;
};

const updateAppLiveCount = async (
  tx: RelationalDatabase,
  userId: number,
  appId: string,
  delta: number,
  now: number,
): Promise<void> => {
  if (delta === 0) return;
  const result =
    delta > 0
      ? await tx.execute(
          `UPDATE agent_apps SET running_count = running_count + ?, version = version + 1, updated_at = ?
           WHERE user_id = ? AND app_id = ? AND desired_state = 'enabled'`,
          [delta, now, userId, appId],
        )
      : await tx.execute(
          `UPDATE agent_apps SET running_count = running_count + ?, version = version + 1, updated_at = ?
           WHERE user_id = ? AND app_id = ? AND running_count >= ?`,
          [delta, now, userId, appId, -delta],
        );
  if (result.changes !== 1) throw new Error('APP_RUN_COUNT_CONFLICT');
};

const appendEvents = async (
  tx: RelationalDatabase,
  row: RunRow,
  events: readonly DurableEventInput[],
  now: number,
): Promise<RunEvent[]> => {
  validateEvents(events);
  const committed: RunEvent[] = [];
  let sequence = row.next_event_sequence;
  for (const event of events) {
    const eventId = randomUUID();
    await tx.execute(
      `INSERT INTO agent_events (event_id, run_id, sequence, schema_version, type, payload_json, occurred_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [eventId, row.id, sequence, event.type, JSON.stringify(event.payload), now],
    );
    committed.push({
      eventId,
      runId: row.id,
      sequence,
      schemaVersion: 1,
      type: event.type,
      payload: event.payload,
      occurredAt: now,
    });
    sequence += 1;
  }
  return committed;
};

const appendLedger = async (
  tx: RelationalDatabase,
  row: RunRow,
  entries: readonly LedgerAppendInput[],
  now: number,
): Promise<number> => {
  if (entries.length === 0) return 0;
  const thread = await tx.queryOne<ThreadRow>(
    'SELECT next_sequence, version FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?',
    [row.thread_id, row.user_id, row.app_id],
  );
  if (!thread) throw new Error('NOT_FOUND');
  let sequence = thread.next_sequence;
  for (const entry of entries) {
    await tx.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        row.thread_id,
        row.user_id,
        row.app_id,
        entry.runId ?? row.id,
        sequence,
        entry.kind,
        JSON.stringify(entry.payload),
        now,
      ],
    );
    sequence += 1;
  }
  const updated = await tx.execute(
    `UPDATE ai_threads SET next_sequence = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    [sequence, now, row.thread_id, row.user_id, row.app_id, thread.version],
  );
  if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
  return sequence - 1;
};

const patchRun = async (
  tx: RelationalDatabase,
  row: RunRow,
  patch: RunProjectionPatch,
  eventCount: number,
  now: number,
): Promise<RunRow> => {
  const assignments = ['version = version + 1', 'updated_at = ?', 'next_event_sequence = next_event_sequence + ?'];
  const parameters: unknown[] = [now, eventCount];
  const add = (sql: string, value: unknown): void => {
    assignments.push(sql);
    parameters.push(value);
  };
  if (patch.status !== undefined) add('status = ?', patch.status);
  if (
    (row.status === 'running' || row.status === 'cancelling') &&
    patch.status !== undefined &&
    patch.status !== 'running' &&
    patch.status !== 'cancelling'
  ) {
    const active = await tx.queryOne<{ active_execution_started_at: number | null }>(
      'SELECT active_execution_started_at FROM agent_runs WHERE id = ?',
      [row.id],
    );
    const activeDelta = active?.active_execution_started_at ? Math.max(0, now - active.active_execution_started_at) : 0;
    assignments.push('active_execution_seconds = active_execution_seconds + ?');
    parameters.push(activeDelta);
    assignments.push('active_execution_started_at = NULL', 'executing_runtime_count = 0');
  }
  if (patch.goalStatus !== undefined) add('goal_status = ?', patch.goalStatus);
  if (patch.verificationStatus !== undefined) add('verification_status = ?', patch.verificationStatus);
  if (patch.needsReconciliation !== undefined) add('needs_reconciliation = ?', patch.needsReconciliation ? 1 : 0);
  if (patch.budget !== undefined) add('budget_json = ?', JSON.stringify(patch.budget));
  if (patch.usage !== undefined) add('usage_json = ?', JSON.stringify(patch.usage));
  if (patch.plan !== undefined) add('plan_json = ?', JSON.stringify(patch.plan));
  if (patch.consumedInputSequence !== undefined) add('consumed_input_sequence = ?', patch.consumedInputSequence);
  if (patch.inputRevision !== undefined) add('input_revision = ?', patch.inputRevision);
  if (patch.startedAt !== undefined) add('started_at = ?', patch.startedAt);
  if (patch.completedAt !== undefined) add('completed_at = ?', patch.completedAt);
  parameters.push(row.id, row.user_id, row.app_id, row.version);
  const updated = await tx.execute(
    `UPDATE agent_runs SET ${assignments.join(', ')} WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
    parameters,
  );
  if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
  const result = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [row.id, row.user_id, row.app_id],
  );
  if (!result) throw new Error('NOT_FOUND');
  return result;
};

const artifactForInput = async (
  tx: RelationalDatabase,
  userId: number,
  appId: string,
  threadId: string,
  runId: string,
  artifactId: string,
  now: number,
): Promise<void> => {
  const artifact = await tx.queryOne<ArtifactRow>(
    `SELECT status, app_id FROM ai_artifacts WHERE id = ? AND user_id = ? AND status <> 'deleted'`,
    [artifactId, userId],
  );
  if (!artifact || artifact.status !== 'ready') throw new Error('ARTIFACT_UNAVAILABLE');
  if (artifact.app_id === appId) return;
  const grant = await tx.queryOne<{ id: string }>(
    `SELECT id FROM agent_artifact_grants
     WHERE artifact_id = ? AND receiver_user_id = ? AND receiver_app_id = ?
       AND receiver_thread_id = ? AND role = 'input' AND revoked_at IS NULL
       AND (receiver_run_id IS NULL OR receiver_run_id = ?)
       AND (expires_at IS NULL OR expires_at > ?)
     LIMIT 1`,
    [artifactId, userId, appId, threadId, runId, now],
  );
  if (!grant) throw new Error('ARTIFACT_CROSS_APP_ATTACH_REQUIRED');
};

export class SqliteStateCommitAdapter implements StateCommitPort {
  constructor(private readonly db: RelationalDatabase) {}

  async createRun(command: AtomicCreateRun): Promise<CreateRunCommitResult> {
    return this.db.transaction(async (tx) => {
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
          id, user_id, app_id, thread_id, parent_run_id, status, goal_status, verification_status,
          needs_reconciliation, budget_json, definition_json, plan_json, usage_json,
          active_execution_seconds, active_execution_started_at, executing_runtime_count,
          next_event_sequence, consumed_input_sequence, input_revision, version,
          created_at, started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'created', 'unknown', 'not_started', 0, ?, ?, ?, ?, 0, NULL, 0, 2, 0, 1, 1, ?, NULL, NULL, ?)`,
        [
          command.runId,
          command.scope.userId,
          command.scope.appId,
          command.threadId,
          command.parentRunId ?? null,
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
    });
  }

  async appendInput(command: AtomicAppendInput): Promise<AppendInputCommitResult> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<CommandRow>(
        `SELECT status, request_hash, response_json FROM agent_commands
         WHERE user_id = ? AND app_id = ? AND command_name = 'run.input' AND idempotency_key = ?`,
        [command.scope.userId, command.scope.appId, command.idempotencyKey],
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
         VALUES (?, ?, ?, 'run.input', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
        [
          randomUUID(),
          command.scope.userId,
          command.scope.appId,
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
         WHERE user_id = ? AND app_id = ? AND command_name = 'run.input' AND idempotency_key = ? AND status = 'pending'`,
        [JSON.stringify(response), command.now, row.user_id, row.app_id, command.idempotencyKey],
      );
      if (completed.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
      return {
        ...response,
        run,
        replayed: false,
        shouldInterruptModel: Boolean(streamingModel),
        shouldReschedule: Boolean(waitingApproval),
      };
    });
  }

  async cancelRun(command: AtomicCancelRun): Promise<CancelRunCommitResult> {
    return this.db.transaction(async (tx) => {
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
        const immediate = row.status !== 'running' && row.status !== 'cancelling';
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
          { type: 'run.status_changed', payload: { from: row.status, to: nextStatus } },
        ];
        await appendEvents(tx, row, events, command.now);
        const changed = await tx.execute(
          `UPDATE agent_runs SET status = ?, completed_at = ?, executing_runtime_count = ?,
             active_execution_started_at = CASE WHEN ? = 'cancelled' THEN NULL ELSE active_execution_started_at END,
             next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
           WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
          [
            nextStatus,
            immediate ? command.now : null,
            immediate ? 0 : 1,
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
            `UPDATE agent_runtimes SET status = 'stopped', updated_at = ?
             WHERE run_id = ? AND status IN ('created','running','stopping')`,
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
    });
  }

  async increaseRunBudget(command: AtomicIncreaseRunBudget): Promise<IncreaseRunBudgetCommitResult> {
    return this.db.transaction(async (tx) => {
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
    });
  }

  async deleteRun(command: AtomicDeleteRun): Promise<DeleteRunCommitResult> {
    return this.db.transaction(async (tx) => {
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
    });
  }

  async beginModelStep(command: BeginModelStepCommand): Promise<BeginModelStepResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
      if (row.input_revision !== command.inputWatermark) throw new Error('INPUT_REVISION_CONFLICT');
      if (!['created', 'running'].includes(row.status)) throw new Error('RUN_NOT_SCHEDULABLE');
      const firstStep = row.status === 'created';
      const app = await tx.queryOne<{ desired_state: string }>(
        'SELECT desired_state FROM agent_apps WHERE user_id = ? AND app_id = ?',
        [row.user_id, row.app_id],
      );
      if (!app || app.desired_state !== 'enabled') throw new Error('AGENT_APP_DISABLED');
      const runtime = await tx.queryOne<{ status: string; schedule_state: string }>(
        'SELECT status, schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
        [command.runtimeId, command.runId],
      );
      if (
        !runtime ||
        !['created', 'running'].includes(runtime.status) ||
        !['queued', 'runnable'].includes(runtime.schedule_state)
      ) {
        throw new Error('RUNTIME_NOT_SCHEDULABLE');
      }
      const previous = await tx.queryOne<{ max_index: number | null }>(
        'SELECT MAX(step_index) AS max_index FROM agent_steps WHERE run_id = ?',
        [command.runId],
      );
      const stepIndex = (previous?.max_index ?? 0) + 1;
      const stepId = randomUUID();
      const attemptId = randomUUID();
      await tx.execute(
        `INSERT INTO agent_steps
          (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
           input_refs_json, output_refs_json, created_at, completed_at)
         VALUES (?, ?, ?, ?, 'model', 'running', ?, '[]', '[]', ?, NULL)`,
        [stepId, command.runId, command.runtimeId, stepIndex, command.inputWatermark, command.now],
      );
      await tx.execute(
        `INSERT INTO agent_model_attempts
          (id, step_id, attempt_index, status, reserved_tokens, input_tokens, output_tokens,
           cached_input_tokens, cost_micros, price_version, estimated, error_code, created_at, completed_at)
         VALUES (?, ?, 1, 'streaming', ?, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
        [attemptId, stepId, command.reservedTokens, command.now],
      );
      await tx.execute(
        `UPDATE agent_runtimes SET status = 'running', schedule_state = 'executing', updated_at = ?
         WHERE id = ? AND run_id = ? AND status IN ('created','running')`,
        [command.now, command.runtimeId, command.runId],
      );
      const events: DurableEventInput[] = [
        ...(firstStep ? [{ type: 'run.status_changed', payload: { from: 'created', to: 'running' } } as const] : []),
        { type: 'model.started', payload: { stepId, attemptId, attemptIndex: 1 } },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const updated = await tx.execute(
        `UPDATE agent_runs SET
           status = 'running', goal_status = 'in_progress', started_at = COALESCE(started_at, ?),
           active_execution_started_at = CASE WHEN executing_runtime_count = 0 THEN ? ELSE active_execution_started_at END,
           executing_runtime_count = executing_runtime_count + 1,
           next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
        [
          command.now,
          command.now,
          events.length,
          command.now,
          command.runId,
          command.scope.userId,
          command.scope.appId,
          row.version,
        ],
      );
      if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
      if (firstStep) await updateAppLiveCount(tx, row.user_id, row.app_id, 1, command.now);
      const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [
        command.runId,
      ]);
      if (!updatedRow) throw new Error('NOT_FOUND');
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, stepId, attemptId, attemptIndex: 1, committedEvents };
    });
  }

  async beginSubagentModelStep(command: BeginSubagentModelStepCommand): Promise<BeginModelStepResult> {
    return this.db.transaction(async (tx) => {
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
        [
          JSON.stringify(nextUsage),
          command.now,
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
      return { run, stepId, attemptId, attemptIndex: 1, committedEvents };
    });
  }

  async pauseRuntimeForBudget(command: PauseRuntimeForBudgetCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
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
    });
  }

  async parkRuntime(command: ParkRuntimeCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
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
    });
  }

  async parkModelStep(command: ParkModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
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
      await tx.execute(
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
      await tx.execute(
        `UPDATE agent_steps SET status = 'completed', completed_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [command.now, command.stepId, command.runId],
      );
      const scheduleState = command.reason === 'waiting_subagents' ? 'joining' : 'waiting_message';
      const runtimeChanged = await tx.execute(
        `UPDATE agent_runtimes SET status = 'running', schedule_state = ?, updated_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [scheduleState, command.now, command.runtimeId, command.runId],
      );
      if (runtimeChanged.changes !== 1) throw new Error('RUNTIME_NOT_SCHEDULABLE');
      let ledgerCursor = 0;
      if (command.assistantText !== undefined && command.assistantEntryId) {
        ledgerCursor = await appendLedger(
          tx,
          row,
          [
            {
              id: command.assistantEntryId,
              runId: command.runId,
              kind: 'assistant_message',
              payload: { text: command.assistantText },
            },
          ],
          command.now,
        );
      }
      const events: DurableEventInput[] = [
        {
          type: 'model.completed',
          payload: {
            stepId: command.stepId,
            attemptId: command.attemptId,
            runtimeId: command.runtimeId,
            finishReason: command.finishReason,
            inputTokens: command.inputTokens,
            outputTokens: command.outputTokens,
          },
        },
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
        `UPDATE agent_runs SET usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
         active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
         executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'running'`,
        [
          JSON.stringify(
            usageWithDelta(row, {
              inputTokens: command.inputTokens,
              outputTokens: command.outputTokens,
              cachedInputTokens: command.cachedInputTokens,
              costMicros: command.costMicros,
              steps: 1,
            }),
          ),
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
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async commitSubagentToolProposal(command: CommitSubagentToolProposalCommand): Promise<CommitToolProposalResult> {
    return this.db.transaction(async (tx) => {
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
      if (
        delegation.used_tokens + tokenDelta > delegation.max_tokens ||
        delegation.used_steps >= delegation.max_steps
      ) {
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
    });
  }

  async beginSubagentTool(command: BeginSubagentToolCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
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
    });
  }

  async settleSubagentTool(command: SettleSubagentToolCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
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
      const nextDelegationStatus = cancelling
        ? 'cancelled'
        : command.continuation === 'runnable'
          ? 'running'
          : 'waiting';
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
    });
  }

  async settleSubagentWithoutModel(command: SettleSubagentWithoutModelCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
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
    });
  }

  async settleSubagentModelStep(command: SettleSubagentModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
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
      }>(
        `SELECT status, child_runtime_id, used_tokens, max_tokens FROM agent_delegations WHERE id = ? AND run_id = ?`,
        [command.delegationId, command.runId],
      );
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
    });
  }

  async retryModelStep(command: RetryModelStepCommand): Promise<RetryModelStepResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
      const step = await tx.queryOne<{ status: string }>(
        'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
        [command.stepId, command.runId, command.runtimeId],
      );
      if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
      const attempt = await tx.queryOne<{ status: string; attempt_index: number }>(
        `SELECT a.status, a.attempt_index FROM agent_model_attempts a
         JOIN agent_steps s ON s.id = a.step_id
         WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
        [command.attemptId, command.stepId, command.runId],
      );
      if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

      const closed = await tx.execute(
        `UPDATE agent_model_attempts SET status = 'failed', input_tokens = ?, output_tokens = ?,
           cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?, error_code = ?, completed_at = ?
         WHERE id = ? AND status = 'streaming'`,
        [
          command.inputTokens ?? null,
          command.outputTokens ?? null,
          command.cachedInputTokens ?? null,
          command.costMicros ?? null,
          command.priceVersion ?? null,
          command.estimatedUsage ? 1 : 0,
          command.errorCode,
          command.now,
          command.attemptId,
        ],
      );
      if (closed.changes !== 1) throw new Error('ATTEMPT_STATE_CONFLICT');

      const attemptIndex = attempt.attempt_index + 1;
      const attemptId = randomUUID();
      await tx.execute(
        `INSERT INTO agent_model_attempts
          (id, step_id, attempt_index, status, reserved_tokens, input_tokens, output_tokens,
           cached_input_tokens, cost_micros, price_version, estimated, error_code, created_at, completed_at)
         VALUES (?, ?, ?, 'streaming', ?, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
        [attemptId, command.stepId, attemptIndex, command.reservedTokens, command.now],
      );
      const events: DurableEventInput[] = [
        {
          type: 'model.retrying',
          payload: {
            stepId: command.stepId,
            previousAttemptId: command.attemptId,
            attemptId,
            attemptIndex,
            errorCode: command.errorCode,
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
      const updatedRow = await patchRun(tx, row, { usage: mergedUsage }, events.length, command.now);
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return {
        run,
        eventCursor: run.eventCursor,
        ledgerCursor: 0,
        committedEvents,
        attemptId,
        attemptIndex,
      };
    });
  }

  async pauseModelStepForBudget(command: PauseModelStepForBudgetCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
      const step = await tx.queryOne<{ status: string }>(
        'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
        [command.stepId, command.runId, command.runtimeId],
      );
      if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
      const attempt = await tx.queryOne<{ status: string }>(
        `SELECT a.status FROM agent_model_attempts a
         JOIN agent_steps s ON s.id = a.step_id
         WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
        [command.attemptId, command.stepId, command.runId],
      );
      if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

      const attemptChanged = await tx.execute(
        `UPDATE agent_model_attempts SET status = 'failed', input_tokens = ?, output_tokens = ?,
           cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?, error_code = ?, completed_at = ?
         WHERE id = ? AND status = 'streaming'`,
        [
          command.inputTokens ?? null,
          command.outputTokens ?? null,
          command.cachedInputTokens ?? null,
          command.costMicros ?? null,
          command.priceVersion ?? null,
          command.estimatedUsage ? 1 : 0,
          command.errorCode,
          command.now,
          command.attemptId,
        ],
      );
      const stepChanged = await tx.execute(
        `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [command.now, command.stepId, command.runId],
      );
      if (attemptChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('ATTEMPT_STATE_CONFLICT');
      const runtimeChanged = await tx.execute(
        `UPDATE agent_runtimes SET schedule_state = 'waiting_budget', updated_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'executing'`,
        [command.now, command.runtimeId, command.runId],
      );
      if (runtimeChanged.changes !== 1) throw new Error('RUNTIME_NOT_SCHEDULABLE');

      const events: DurableEventInput[] = [
        {
          type: 'model.failed',
          payload: { stepId: command.stepId, attemptId: command.attemptId, errorCode: command.errorCode },
        },
        { type: 'budget.increase_requested', payload: command.budgetReason },
        { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_budget' } },
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
        `UPDATE agent_runs SET status = 'awaiting_budget', usage_json = ?,
         active_execution_seconds = active_execution_seconds + ?,
         active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
         executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
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
      const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
      if (!updatedRow) throw new Error('NOT_FOUND');
      await tx.execute(
        `UPDATE agent_apps SET budget_request_count = budget_request_count + 1, updated_at = ?
         WHERE user_id = ? AND app_id = ?`,
        [command.now, row.user_id, row.app_id],
      );
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
    });
  }

  async settleModelStep(command: SettleModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
      if (!['running', 'cancelling'].includes(row.status)) throw new Error('RUN_NOT_SETTLEABLE');
      const step = await tx.queryOne<{ status: string }>(
        'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
        [command.stepId, command.runId, command.runtimeId],
      );
      if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
      const attempt = await tx.queryOne<{ status: string }>(
        `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
         WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
        [command.attemptId, command.stepId, command.runId],
      );
      if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

      const succeeded = command.terminalStatus === 'completed_unverified';
      await tx.execute(
        `UPDATE agent_model_attempts SET
           status = ?, input_tokens = ?, output_tokens = ?, cached_input_tokens = ?, cost_micros = ?,
           price_version = ?, estimated = ?, error_code = ?, completed_at = ?
         WHERE id = ? AND status = 'streaming'`,
        [
          succeeded ? 'completed' : command.terminalStatus === 'cancelled' ? 'aborted' : 'failed',
          command.inputTokens ?? null,
          command.outputTokens ?? null,
          command.cachedInputTokens ?? null,
          command.costMicros ?? null,
          command.priceVersion ?? null,
          command.estimatedUsage ? 1 : 0,
          command.errorCode ?? null,
          command.now,
          command.attemptId,
        ],
      );
      await tx.execute(
        `UPDATE agent_steps SET status = ?, completed_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [
          succeeded ? 'completed' : command.terminalStatus === 'cancelled' ? 'cancelled' : 'failed',
          command.now,
          command.stepId,
          command.runId,
        ],
      );
      await tx.execute(
        `UPDATE agent_runtimes SET status = ?, schedule_state = 'finished', updated_at = ? WHERE id = ? AND run_id = ?`,
        [
          command.terminalStatus === 'cancelled' ? 'stopped' : succeeded ? 'stopped' : 'failed',
          command.now,
          command.runtimeId,
          command.runId,
        ],
      );

      let ledgerCursor = 0;
      if (command.assistantText !== undefined && command.assistantEntryId) {
        ledgerCursor = await appendLedger(
          tx,
          row,
          [
            {
              id: command.assistantEntryId,
              runId: command.runId,
              kind: 'assistant_message',
              payload: { text: command.assistantText },
            },
          ],
          command.now,
        );
      }
      const events: DurableEventInput[] = succeeded
        ? [
            {
              type: 'model.completed',
              payload: {
                stepId: command.stepId,
                attemptId: command.attemptId,
                finishReason: command.finishReason ?? null,
                inputTokens: command.inputTokens ?? null,
                outputTokens: command.outputTokens ?? null,
              },
            },
            { type: 'message.final', payload: { text: command.assistantText ?? '' } },
            {
              type: 'verification.completed',
              payload: { status: 'unverified', summary: 'No tool evidence was required.' },
            },
            { type: 'run.status_changed', payload: { from: row.status, to: command.terminalStatus } },
          ]
        : [
            {
              type: command.terminalStatus === 'cancelled' ? 'model.aborted' : 'model.failed',
              payload: { stepId: command.stepId, attemptId: command.attemptId, errorCode: command.errorCode ?? null },
            },
            { type: 'run.status_changed', payload: { from: row.status, to: command.terminalStatus } },
          ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const activeStarted = await tx.queryOne<{ active_execution_started_at: number | null }>(
        'SELECT active_execution_started_at FROM agent_runs WHERE id = ?',
        [command.runId],
      );
      const activeDelta = activeStarted?.active_execution_started_at
        ? Math.max(0, command.now - activeStarted.active_execution_started_at)
        : 0;
      const mergedUsage = usageWithDelta(row, {
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
        cachedInputTokens: command.cachedInputTokens,
        costMicros: command.costMicros,
        steps: 1,
      });
      const updated = await tx.execute(
        `UPDATE agent_runs SET
           status = ?, verification_status = ?, goal_status = ?, needs_reconciliation = 0,
           usage_json = ?, active_execution_seconds = active_execution_seconds + ?,
           active_execution_started_at = NULL, executing_runtime_count = 0,
           completed_at = ?, updated_at = ?, next_event_sequence = next_event_sequence + ?, version = version + 1
         WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
        [
          command.terminalStatus,
          succeeded ? 'unverified' : command.terminalStatus === 'cancelled' ? 'not_started' : 'failed',
          succeeded ? 'satisfied' : command.terminalStatus === 'cancelled' ? row.goal_status : 'not_satisfied',
          JSON.stringify(mergedUsage),
          activeDelta,
          command.now,
          command.now,
          events.length,
          command.runId,
          command.scope.userId,
          command.scope.appId,
          row.version,
        ],
      );
      if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
      await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
      const updatedRow = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [
        command.runId,
      ]);
      if (!updatedRow) throw new Error('NOT_FOUND');
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async commitToolProposal(command: CommitToolProposalCommand): Promise<CommitToolProposalResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
      if (row.status !== 'running') throw new Error('RUN_NOT_SETTLEABLE');
      if (row.input_revision !== command.inspection.inputRevision) throw new Error('INPUT_REVISION_CONFLICT');
      const step = await tx.queryOne<{ status: string }>(
        'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
        [command.modelStepId, command.runId, command.runtimeId],
      );
      if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
      const attempt = await tx.queryOne<{ status: string }>(
        `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
         WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
        [command.attemptId, command.modelStepId, command.runId],
      );
      if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

      await tx.execute(
        `UPDATE agent_model_attempts SET status = 'completed', input_tokens = ?, output_tokens = ?,
           cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?, completed_at = ?
         WHERE id = ? AND status = 'streaming'`,
        [
          command.inputTokens ?? null,
          command.outputTokens ?? null,
          command.cachedInputTokens ?? null,
          command.costMicros ?? null,
          command.priceVersion ?? null,
          command.estimatedUsage ? 1 : 0,
          command.now,
          command.attemptId,
        ],
      );
      await tx.execute(
        `UPDATE agent_steps SET status = 'completed', completed_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [command.now, command.modelStepId, command.runId],
      );

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

      const ledgerCursor = await appendLedger(
        tx,
        row,
        [
          {
            id: command.assistantEntryId,
            runId: command.runId,
            kind: 'assistant_message',
            payload: {
              text: command.assistantText,
              toolCalls: [
                {
                  id: command.providerCallId,
                  name: command.toolName,
                  argumentsJson: command.argumentsJson,
                },
              ],
            },
          },
        ],
        command.now,
      );
      const events: DurableEventInput[] = [
        {
          type: 'model.completed',
          payload: {
            stepId: command.modelStepId,
            attemptId: command.attemptId,
            finishReason: command.finishReason ?? 'tool_calls',
            inputTokens: command.inputTokens ?? null,
            outputTokens: command.outputTokens ?? null,
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
          },
        },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const mergedUsage = usageWithDelta(row, {
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
        cachedInputTokens: command.cachedInputTokens,
        costMicros: command.costMicros,
        steps: 1,
      });
      const updatedRow = await patchRun(tx, row, { usage: mergedUsage }, events.length, command.now);
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return {
        run,
        eventCursor: run.eventCursor,
        ledgerCursor,
        committedEvents,
        toolStepId,
        toolCallId: command.toolCallId,
      };
    });
  }

  async requestToolApproval(command: RequestToolApprovalCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
      if (row.input_revision !== command.inspection.inputRevision) throw new Error('APPROVAL_STALE');
      const app = await tx.queryOne<{ policy_revision: number }>(
        'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
        [row.user_id, row.app_id],
      );
      if (!app || app.policy_revision !== command.inspection.policyRevision)
        throw new Error('POLICY_REVISION_CONFLICT');
      const tool = await tx.queryOne<{ status: string; operation_hash: string; risk: string }>(
        'SELECT status, operation_hash, risk FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
        [command.toolCallId, command.runId, command.toolStepId],
      );
      if (
        !tool ||
        tool.status !== 'proposed' ||
        tool.operation_hash !== command.inspection.operationHash ||
        tool.risk === 'read'
      ) {
        throw new Error('TOOL_STATE_CONFLICT');
      }
      if (command.expiresAt <= command.now || command.expiresAt > command.now + 600)
        throw new Error('VALIDATION_FAILED');
      await tx.execute(
        `INSERT INTO agent_approvals
          (id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
           operation_hash_version, status, policy_revision, input_revision, decided_by_user_id,
           decided_at, consumed_at, requested_at, expires_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'requested', ?, ?, NULL, NULL, NULL, ?, ?, 1)`,
        [
          command.approvalId,
          row.user_id,
          row.app_id,
          row.id,
          command.toolCallId,
          command.runtimeId,
          command.inspection.operationHash,
          command.inspection.policyRevision,
          command.inspection.inputRevision,
          command.now,
          command.expiresAt,
        ],
      );
      const toolChanged = await tx.execute(
        `UPDATE agent_tool_calls SET status = 'awaiting_approval', version = version + 1
         WHERE id = ? AND run_id = ? AND status = 'proposed'`,
        [command.toolCallId, row.id],
      );
      if (toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
      await tx.execute(
        `UPDATE agent_runtimes SET schedule_state = 'waiting_approval', updated_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [command.now, command.runtimeId, command.runId],
      );
      const events: DurableEventInput[] = [
        {
          type: 'approval.requested',
          payload: {
            approvalId: command.approvalId,
            toolCallId: command.toolCallId,
            operationHash: command.inspection.operationHash,
            expiresAt: command.expiresAt,
            risk: command.inspection.risk,
          },
        },
        { type: 'run.status_changed', payload: { from: 'running', to: 'awaiting_approval' } },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const updatedRow = await patchRun(tx, row, { status: 'awaiting_approval' }, events.length, command.now);
      await tx.execute(
        `UPDATE agent_apps SET approval_count = approval_count + 1, updated_at = ? WHERE user_id = ? AND app_id = ?`,
        [command.now, row.user_id, row.app_id],
      );
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
    });
  }

  async resolveToolApproval(command: ResolveToolApprovalCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<CommandRow>(
        `SELECT status, request_hash, response_json FROM agent_commands
         WHERE user_id = ? AND app_id = ? AND command_name = 'approval.resolve' AND idempotency_key = ?`,
        [command.scope.userId, command.scope.appId, command.idempotencyKey],
      );
      if (existing) {
        if (existing.request_hash !== command.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        if (existing.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
        if (existing.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
        if (!existing.response_json) throw new Error('IDEMPOTENCY_RESPONSE_MISSING');
        const replay = JSON.parse(existing.response_json) as { runId: string; approvalId: string };
        if (replay.approvalId !== command.approvalId) throw new Error('RECONCILIATION_REQUIRED');
        const replayRow = await tx.queryOne<RunRow>(
          `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
          [replay.runId, command.scope.userId, command.scope.appId],
        );
        if (!replayRow) throw new Error('RECONCILIATION_REQUIRED');
        const run = mapRunRow(replayRow);
        return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents: [] };
      }
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version !== command.expectedRunVersion || row.status !== 'awaiting_approval')
        throw new Error('STATE_CONFLICT');
      if (row.input_revision !== command.expectedInputRevision) throw new Error('APPROVAL_STALE');
      const app = await tx.queryOne<{ policy_revision: number }>(
        'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
        [row.user_id, row.app_id],
      );
      if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('APPROVAL_STALE');
      const approval = await tx.queryOne<{
        tool_call_id: string;
        provider_call_id: string;
        operation_hash: string;
        status: string;
        version: number;
        policy_revision: number;
        input_revision: number;
        expires_at: number;
        requested_by_runtime_id: string;
      }>(
        `SELECT a.tool_call_id, t.provider_call_id, a.operation_hash, a.status, a.version,
                a.policy_revision, a.input_revision, a.expires_at, a.requested_by_runtime_id
         FROM agent_approvals a
         JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
         WHERE a.id = ? AND a.user_id = ? AND a.app_id = ? AND a.run_id = ?`,
        [command.approvalId, row.user_id, row.app_id, row.id],
      );
      if (
        !approval ||
        approval.status !== 'requested' ||
        approval.version !== command.expectedApprovalVersion ||
        approval.operation_hash !== command.operationHash ||
        approval.policy_revision !== command.expectedPolicyRevision ||
        approval.input_revision !== command.expectedInputRevision ||
        approval.expires_at <= command.now
      ) {
        throw new Error('APPROVAL_STALE');
      }
      await tx.execute(
        `INSERT INTO agent_commands
          (id, user_id, app_id, command_name, idempotency_key, request_hash, status, response_status,
           response_json, result_entity_id, generation, created_at, completed_at, expires_at)
         VALUES (?, ?, ?, 'approval.resolve', ?, ?, 'pending', NULL, NULL, ?, 1, ?, NULL, ?)`,
        [
          randomUUID(),
          row.user_id,
          row.app_id,
          command.idempotencyKey,
          command.requestHash,
          command.approvalId,
          command.now,
          command.now + IDEMPOTENCY_TTL_SECONDS,
        ],
      );
      const changed = await tx.execute(
        `UPDATE agent_approvals SET status = ?, decided_by_user_id = ?, decided_at = ?, version = version + 1
         WHERE id = ? AND status = 'requested' AND version = ? AND expires_at > ?`,
        [
          command.decision,
          command.decidedByUserId,
          command.now,
          command.approvalId,
          command.expectedApprovalVersion,
          command.now,
        ],
      );
      if (changed.changes !== 1) throw new Error('APPROVAL_STALE');
      const toolStatus = command.decision === 'approved' ? 'ready' : 'cancelled';
      const toolChanged = await tx.execute(
        `UPDATE agent_tool_calls SET status = ?, version = version + 1,
           completed_at = CASE WHEN ? = 'cancelled' THEN ? ELSE completed_at END
         WHERE id = ? AND run_id = ? AND status = 'awaiting_approval' AND operation_hash = ?`,
        [toolStatus, toolStatus, command.now, approval.tool_call_id, row.id, command.operationHash],
      );
      if (toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
      await tx.execute(
        `UPDATE agent_runtimes SET schedule_state = 'runnable', updated_at = ?
         WHERE id = ? AND run_id = ? AND schedule_state = 'waiting_approval'`,
        [command.now, approval.requested_by_runtime_id, row.id],
      );
      let ledgerCursor = 0;
      if (command.decision === 'denied') {
        await tx.execute(
          `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
           WHERE id = (SELECT step_id FROM agent_tool_calls WHERE id = ?) AND run_id = ? AND status = 'created'`,
          [command.now, approval.tool_call_id, row.id],
        );
        ledgerCursor = await appendLedger(
          tx,
          row,
          [
            {
              id: randomUUID(),
              runId: row.id,
              kind: 'tool_result',
              payload: {
                toolCallId: approval.provider_call_id,
                text: JSON.stringify({
                  ok: false,
                  outcome: 'confirmed',
                  errorCode: 'APPROVAL_DENIED',
                  summary: 'The user denied this remote mutation.',
                }),
              },
            },
          ],
          command.now,
        );
      }
      const events: DurableEventInput[] = [
        {
          type: command.decision === 'approved' ? 'approval.approved' : 'approval.denied',
          payload: {
            approvalId: command.approvalId,
            toolCallId: approval.tool_call_id,
            operationHash: command.operationHash,
          },
        },
        { type: 'run.status_changed', payload: { from: 'awaiting_approval', to: 'running' } },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const updatedRow = await patchRun(tx, row, { status: 'running' }, events.length, command.now);
      await tx.execute(
        `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ? WHERE user_id = ? AND app_id = ?`,
        [command.now, row.user_id, row.app_id],
      );
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      const commandCompleted = await tx.execute(
        `UPDATE agent_commands SET status = 'committed', response_status = 200, response_json = ?, completed_at = ?
         WHERE user_id = ? AND app_id = ? AND command_name = 'approval.resolve'
           AND idempotency_key = ? AND status = 'pending'`,
        [
          JSON.stringify({ runId: run.id, approvalId: command.approvalId }),
          command.now,
          row.user_id,
          row.app_id,
          command.idempotencyKey,
        ],
      );
      if (commandCompleted.changes !== 1) throw new Error('IDEMPOTENCY_STATE_CONFLICT');
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async expireToolApprovals(now: number): Promise<RunView[]> {
    return this.db.transaction(async (tx) => {
      const expired = await tx.queryAll<{
        approval_id: string;
        run_id: string;
        user_id: number;
        app_id: string;
        tool_call_id: string;
        provider_call_id: string;
        step_id: string;
      }>(
        `SELECT a.id AS approval_id, a.run_id, a.user_id, a.app_id, a.tool_call_id,
                t.provider_call_id, t.step_id
         FROM agent_approvals a
         JOIN agent_runs r ON r.id = a.run_id AND r.user_id = a.user_id AND r.app_id = a.app_id
         JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
         WHERE a.status = 'requested' AND a.expires_at <= ? AND r.status = 'awaiting_approval'
         ORDER BY a.expires_at, a.id`,
        [now],
      );
      const resumed: RunView[] = [];
      for (const item of expired) {
        const row = await tx.queryOne<RunRow>(
          `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
          [item.run_id, item.user_id, item.app_id],
        );
        if (!row || row.status !== 'awaiting_approval') continue;
        const approvalChanged = await tx.execute(
          `UPDATE agent_approvals SET status = 'expired', decided_at = ?, version = version + 1
           WHERE id = ? AND status = 'requested' AND expires_at <= ?`,
          [now, item.approval_id, now],
        );
        if (approvalChanged.changes !== 1) continue;
        const toolChanged = await tx.execute(
          `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
           WHERE id = ? AND run_id = ? AND status = 'awaiting_approval'`,
          [now, item.tool_call_id, row.id],
        );
        const stepChanged = await tx.execute(
          `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
           WHERE id = ? AND run_id = ? AND status = 'created'`,
          [now, item.step_id, row.id],
        );
        if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('APPROVAL_STATE_INVALID');
        const ledgerCursor = await appendLedger(
          tx,
          row,
          [
            {
              id: randomUUID(),
              runId: row.id,
              kind: 'tool_result',
              payload: {
                toolCallId: item.provider_call_id,
                text: JSON.stringify({
                  ok: false,
                  outcome: 'confirmed',
                  errorCode: 'APPROVAL_EXPIRED',
                  summary: 'The approval request expired before it was consumed.',
                }),
              },
            },
          ],
          now,
        );
        const events: DurableEventInput[] = [
          {
            type: 'approval.expired',
            payload: { approvalId: item.approval_id, toolCallId: item.tool_call_id },
          },
          { type: 'run.status_changed', payload: { from: 'awaiting_approval', to: 'running' } },
        ];
        await appendEvents(tx, row, events, now);
        const updatedRow = await patchRun(tx, row, { status: 'running' }, events.length, now);
        await tx.execute(
          `UPDATE agent_apps SET approval_count = MAX(0, approval_count - 1), updated_at = ?
           WHERE user_id = ? AND app_id = ?`,
          [now, row.user_id, row.app_id],
        );
        const run = mapRunRow(updatedRow);
        await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), now);
        void ledgerCursor;
        resumed.push(run);
      }
      return resumed;
    });
  }

  async supersedeMutationTool(command: SupersedeMutationToolCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version !== command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
      const approval = await tx.queryOne<{ status: string; consumed_at: number | null; tool_call_id: string }>(
        `SELECT status, consumed_at, tool_call_id FROM agent_approvals
         WHERE id = ? AND user_id = ? AND app_id = ? AND run_id = ?`,
        [command.approvalId, row.user_id, row.app_id, row.id],
      );
      const tool = await tx.queryOne<{ status: string; provider_call_id: string }>(
        `SELECT status, provider_call_id FROM agent_tool_calls
         WHERE id = ? AND run_id = ? AND step_id = ?`,
        [command.toolCallId, row.id, command.toolStepId],
      );
      if (
        !approval ||
        approval.status !== 'approved' ||
        approval.consumed_at !== null ||
        approval.tool_call_id !== command.toolCallId ||
        !tool ||
        tool.status !== 'ready'
      ) {
        throw new Error('APPROVAL_STALE');
      }
      const approvalChanged = await tx.execute(
        `UPDATE agent_approvals SET status = 'superseded', decided_at = ?, version = version + 1
         WHERE id = ? AND status = 'approved' AND consumed_at IS NULL`,
        [command.now, command.approvalId],
      );
      const toolChanged = await tx.execute(
        `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
         WHERE id = ? AND run_id = ? AND status = 'ready'`,
        [command.now, command.toolCallId, row.id],
      );
      const stepChanged = await tx.execute(
        `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
         WHERE id = ? AND run_id = ? AND status = 'created'`,
        [command.now, command.toolStepId, row.id],
      );
      if (approvalChanged.changes !== 1 || toolChanged.changes !== 1 || stepChanged.changes !== 1) {
        throw new Error('APPROVAL_STALE');
      }
      const ledgerCursor = await appendLedger(
        tx,
        row,
        [
          {
            id: randomUUID(),
            runId: row.id,
            kind: 'tool_result',
            payload: {
              toolCallId: tool.provider_call_id,
              text: JSON.stringify({
                ok: false,
                outcome: 'confirmed',
                errorCode: 'APPROVAL_STALE',
                summary: command.reason,
              }),
            },
          },
        ],
        command.now,
      );
      const events: DurableEventInput[] = [
        {
          type: 'approval.superseded',
          payload: { approvalId: command.approvalId, toolCallId: command.toolCallId, reason: command.reason },
        },
        {
          type: 'tool.failed',
          payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId, errorCode: 'APPROVAL_STALE' },
        },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async beginMutationTool(command: BeginMutationToolCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
      if (row.input_revision !== command.expectedInputRevision) throw new Error('APPROVAL_STALE');
      const app = await tx.queryOne<{ policy_revision: number }>(
        'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
        [row.user_id, row.app_id],
      );
      if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('APPROVAL_STALE');
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
      )
        throw new Error('APPROVAL_STALE');
      const tool = await tx.queryOne<{ status: string; operation_hash: string; risk: string; version: number }>(
        'SELECT status, operation_hash, risk, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
        [command.toolCallId, row.id, command.toolStepId],
      );
      if (!tool || tool.status !== 'ready' || tool.risk === 'read' || tool.operation_hash !== command.operationHash) {
        throw new Error('TOOL_STATE_CONFLICT');
      }
      const approvalChanged = await tx.execute(
        `UPDATE agent_approvals SET consumed_at = ?, version = version + 1
         WHERE id = ? AND status = 'approved' AND consumed_at IS NULL AND version = ? AND expires_at > ?`,
        [command.now, command.approvalId, approval.version, command.now],
      );
      const stepChanged = await tx.execute(
        `UPDATE agent_steps SET status = 'running' WHERE id = ? AND run_id = ? AND status = 'created'`,
        [command.toolStepId, row.id],
      );
      const toolChanged = await tx.execute(
        `UPDATE agent_tool_calls SET status = 'running', started_at = ?, version = version + 1
         WHERE id = ? AND run_id = ? AND status = 'ready' AND version = ?`,
        [command.now, command.toolCallId, row.id, tool.version],
      );
      if (approvalChanged.changes !== 1 || stepChanged.changes !== 1 || toolChanged.changes !== 1) {
        throw new Error('APPROVAL_STALE');
      }
      const events: DurableEventInput[] = [
        { type: 'approval.consumed', payload: { approvalId: command.approvalId, toolCallId: command.toolCallId } },
        { type: 'tool.started', payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId } },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const changedRun = await tx.execute(
        `UPDATE agent_runs SET active_execution_started_at = CASE
             WHEN executing_runtime_count = 0 THEN ? ELSE active_execution_started_at END,
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
    });
  }

  async settleMutationTool(command: SettleMutationToolCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || !['running', 'cancelling'].includes(row.status)) {
        throw new Error('STATE_CONFLICT');
      }
      const tool = await tx.queryOne<{ status: string; version: number }>(
        'SELECT status, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
        [command.toolCallId, row.id, command.toolStepId],
      );
      if (!tool || tool.status !== 'running') throw new Error('TOOL_STATE_CONFLICT');
      const unknown = command.result.outcome === 'unknown' || command.needsReconciliation === true;
      const toolStatus = unknown ? 'reconciling' : command.result.ok ? 'succeeded' : 'failed';
      const safeResult = JSON.parse(JSON.stringify(command.result)) as JsonValue;
      const toolChanged = await tx.execute(
        `UPDATE agent_tool_calls SET status = ?, result_json = ?, completed_at = ?, version = version + 1
         WHERE id = ? AND run_id = ? AND status = 'running' AND version = ?`,
        [toolStatus, JSON.stringify(safeResult), command.now, command.toolCallId, row.id, tool.version],
      );
      const stepChanged = await tx.execute(
        `UPDATE agent_steps SET status = ?, completed_at = ? WHERE id = ? AND run_id = ? AND status = 'running'`,
        [unknown ? 'failed' : command.result.ok ? 'completed' : 'failed', command.now, command.toolStepId, row.id],
      );
      if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
      const ledgerCursor = await appendLedger(
        tx,
        row,
        [
          {
            id: command.toolResultEntryId,
            runId: row.id,
            kind: 'tool_result',
            payload: {
              toolCallId: command.providerCallId,
              text: JSON.stringify(safeResult),
            },
          },
        ],
        command.now,
      );
      const nextStatus: RunStatus = unknown ? 'interrupted' : row.status === 'cancelling' ? 'cancelled' : 'running';
      const terminal = nextStatus === 'interrupted' || nextStatus === 'cancelled';
      const events: DurableEventInput[] = [
        {
          type: unknown ? 'tool.reconciliation_required' : command.result.ok ? 'tool.completed' : 'tool.failed',
          payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId, outcome: command.result.outcome },
        },
        ...(unknown
          ? [{ type: 'run.interrupted', payload: { reason: 'mutation_outcome_unknown', needsReconciliation: true } }]
          : row.status === 'cancelling'
            ? [
                { type: 'run.cancelled', payload: { reason: 'cancel_requested_during_tool' } },
                { type: 'run.status_changed', payload: { from: 'cancelling', to: 'cancelled' } },
              ]
            : []),
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const mergedUsage = usageWithDelta(row, { steps: 1 });
      const updatedRow = await patchRun(
        tx,
        row,
        {
          status: nextStatus,
          usage: mergedUsage,
          needsReconciliation: unknown,
          ...(terminal ? { completedAt: command.now } : {}),
        },
        events.length,
        command.now,
      );
      if (terminal) {
        await tx.execute(
          `UPDATE agent_runtimes SET status = ?, updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping')`,
          [unknown ? 'failed' : 'stopped', command.now, row.id],
        );
        if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
      }
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async beginReadTool(command: BeginReadToolCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
      const step = await tx.queryOne<{ status: string }>(
        'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
        [command.toolStepId, command.runId, command.runtimeId],
      );
      const tool = await tx.queryOne<{ status: string; version: number }>(
        'SELECT status, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
        [command.toolCallId, command.runId, command.toolStepId],
      );
      if (!step || step.status !== 'created' || !tool || tool.status !== 'proposed')
        throw new Error('TOOL_STATE_CONFLICT');
      const stepChanged = await tx.execute(
        `UPDATE agent_steps SET status = 'running' WHERE id = ? AND run_id = ? AND status = 'created'`,
        [command.toolStepId, command.runId],
      );
      const toolChanged = await tx.execute(
        `UPDATE agent_tool_calls SET status = 'running', started_at = ?, version = version + 1
         WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
        [command.now, command.toolCallId, command.runId, tool.version],
      );
      if (stepChanged.changes !== 1 || toolChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
      const events: DurableEventInput[] = [
        { type: 'tool.started', payload: { toolCallId: command.toolCallId, toolStepId: command.toolStepId } },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
    });
  }

  async settleReadTool(command: SettleReadToolCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version < command.expectedRunVersion || !['running', 'cancelling'].includes(row.status)) {
        throw new Error('STATE_CONFLICT');
      }
      const tool = await tx.queryOne<{ status: string; version: number }>(
        'SELECT status, version FROM agent_tool_calls WHERE id = ? AND run_id = ? AND step_id = ?',
        [command.toolCallId, command.runId, command.toolStepId],
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
        `UPDATE agent_steps SET status = ?, completed_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [command.result.ok ? 'completed' : 'failed', command.now, command.toolStepId, command.runId],
      );
      if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
      const ledgerCursor = await appendLedger(
        tx,
        row,
        [
          {
            id: command.toolResultEntryId,
            runId: command.runId,
            kind: 'tool_result',
            payload: {
              toolCallId: command.providerCallId,
              text: JSON.stringify(safeResult),
            },
          },
        ],
        command.now,
      );
      const cancelling = row.status === 'cancelling';
      const events: DurableEventInput[] = [
        {
          type: command.result.ok ? 'tool.completed' : 'tool.failed',
          payload: {
            toolCallId: command.toolCallId,
            toolStepId: command.toolStepId,
            ok: command.result.ok,
            summary: command.result.summary,
            truncated: command.result.truncated,
            verification: command.result.verification.status,
          },
        },
        ...(cancelling
          ? [
              { type: 'run.cancelled', payload: { reason: 'cancel_requested_during_tool' } },
              { type: 'run.status_changed', payload: { from: 'cancelling', to: 'cancelled' } },
            ]
          : []),
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const mergedUsage = usageWithDelta(row, { steps: 1 });
      const updatedRow = await patchRun(
        tx,
        row,
        { usage: mergedUsage, ...(cancelling ? { status: 'cancelled', completedAt: command.now } : {}) },
        events.length,
        command.now,
      );
      if (cancelling) {
        await tx.execute(
          `UPDATE agent_runtimes SET status = 'stopped', updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping')`,
          [command.now, row.id],
        );
        if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
      }
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async supersedeModelStep(command: SupersedeModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.status !== 'running') throw new Error('STATE_CONFLICT');
      if (row.input_revision <= command.expectedInputRevision) throw new Error('INPUT_REVISION_CONFLICT');
      const step = await tx.queryOne<{ status: string; input_watermark: number }>(
        `SELECT status, input_watermark FROM agent_steps
         WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'model'`,
        [command.stepId, command.runId, command.runtimeId],
      );
      if (!step || step.status !== 'running' || step.input_watermark !== command.expectedInputRevision) {
        throw new Error('STEP_STATE_CONFLICT');
      }
      const attempt = await tx.queryOne<{ status: string }>(
        `SELECT a.status FROM agent_model_attempts a
         JOIN agent_steps s ON s.id = a.step_id
         WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
        [command.attemptId, command.stepId, command.runId],
      );
      if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

      const attemptChanged = await tx.execute(
        `UPDATE agent_model_attempts SET status = 'aborted', input_tokens = ?, output_tokens = ?,
           cached_input_tokens = ?, cost_micros = ?, price_version = ?, estimated = ?,
           error_code = 'NEW_INPUT', completed_at = ?
         WHERE id = ? AND status = 'streaming'`,
        [
          command.inputTokens ?? null,
          command.outputTokens ?? null,
          command.cachedInputTokens ?? null,
          command.costMicros ?? null,
          command.priceVersion ?? null,
          command.estimatedUsage ? 1 : 0,
          command.now,
          command.attemptId,
        ],
      );
      const stepChanged = await tx.execute(
        `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [command.now, command.stepId, command.runId],
      );
      if (attemptChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('ATTEMPT_STATE_CONFLICT');

      const events: DurableEventInput[] = [
        {
          type: 'model.aborted',
          payload: {
            stepId: command.stepId,
            attemptId: command.attemptId,
            reason: 'new_input',
            previousInputRevision: command.expectedInputRevision,
            currentInputRevision: row.input_revision,
          },
        },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const mergedUsage = usageWithDelta(row, {
        inputTokens: command.inputTokens,
        outputTokens: command.outputTokens,
        cachedInputTokens: command.cachedInputTokens,
        costMicros: command.costMicros,
        steps: 1,
      });
      const updatedRow = await patchRun(tx, row, { usage: mergedUsage }, events.length, command.now);
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
    });
  }

  async commit(command: StateCommitCommand): Promise<StateCommitResult> {
    validateEvents(command.events);
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!row) throw new Error('NOT_FOUND');
      if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
      if (command.expectedInputRevision !== undefined && row.input_revision !== command.expectedInputRevision) {
        throw new Error('INPUT_REVISION_CONFLICT');
      }
      if (command.expectedPolicyRevision !== undefined) {
        const app = await tx.queryOne<{ policy_revision: number }>(
          'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
          [command.scope.userId, command.scope.appId],
        );
        if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('POLICY_REVISION_CONFLICT');
      }
      const ledgerCursor = await appendLedger(tx, row, command.ledgerAppends ?? [], command.now);
      const committedEvents = await appendEvents(tx, row, command.events, command.now);
      const oldLive = COUNTED_LIVE.has(row.status);
      const nextStatus = command.runPatch.status ?? row.status;
      const newLive = COUNTED_LIVE.has(nextStatus);
      const updatedRow = await patchRun(tx, row, command.runPatch, command.events.length, command.now);
      if (oldLive !== newLive) await updateAppLiveCount(tx, row.user_id, row.app_id, newLive ? 1 : -1, command.now);
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async quiesceApp(appId: string, now: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.queryAll<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs
         WHERE app_id = ? AND status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
         ORDER BY created_at, id`,
        [appId],
      );
      for (const row of rows) {
        const nextStatus: RunStatus =
          row.status === 'running' || row.status === 'cancelling' ? 'interrupted' : 'cancelled';
        const events: DurableEventInput[] = [
          {
            type: nextStatus === 'interrupted' ? 'run.interrupted' : 'run.cancelled',
            payload: { reason: 'app_disabled', needsReconciliation: false },
          },
          { type: 'run.status_changed', payload: { from: row.status, to: nextStatus } },
        ];
        await appendEvents(tx, row, events, now);
        const changed = await tx.execute(
          `UPDATE agent_runs SET status = ?, needs_reconciliation = 0, completed_at = ?, updated_at = ?,
             version = version + 1, executing_runtime_count = 0, active_execution_started_at = NULL,
             next_event_sequence = next_event_sequence + ?
           WHERE id = ? AND version = ?`,
          [nextStatus, now, now, events.length, row.id, row.version],
        );
        if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
        await tx.execute(
          `UPDATE agent_runtimes SET status = ?, updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping')`,
          [nextStatus === 'interrupted' ? 'interrupted' : 'stopped', now, row.id],
        );
        if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, now);
        const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
        if (updated)
          await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(mapRunRow(updated)), now);
      }
      return rows.length;
    });
  }

  async interruptNonTerminalRuns(now: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.queryAll<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs
         WHERE status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
         ORDER BY created_at, id`,
      );
      for (const row of rows) {
        const unknownMutation = await tx.queryOne<{ count: number }>(
          `SELECT COUNT(*) AS count FROM agent_tool_calls
           WHERE run_id = ? AND risk <> 'read' AND status IN ('running','reconciling')`,
          [row.id],
        );
        const needsReconciliation = (unknownMutation?.count ?? 0) > 0;
        const changed = await tx.execute(
          `UPDATE agent_runs SET status = 'interrupted', needs_reconciliation = ?, completed_at = ?, updated_at = ?,
             version = version + 1, executing_runtime_count = 0, active_execution_started_at = NULL,
             next_event_sequence = next_event_sequence + 1
           WHERE id = ? AND version = ?`,
          [needsReconciliation ? 1 : 0, now, now, row.id, row.version],
        );
        if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
        await tx.execute(
          `UPDATE agent_runtimes SET status = 'interrupted', updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping')`,
          [now, row.id],
        );
        await tx.execute(
          `INSERT INTO agent_events (event_id, run_id, sequence, schema_version, type, payload_json, occurred_at)
           VALUES (?, ?, ?, 1, 'run.interrupted', ?, ?)`,
          [
            randomUUID(),
            row.id,
            row.next_event_sequence,
            JSON.stringify({ reason: 'backend_restart', needsReconciliation }),
            now,
          ],
        );
        if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, now);
        const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
        if (updated)
          await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(mapRunRow(updated)), now);
      }
      return rows.length;
    });
  }
}
