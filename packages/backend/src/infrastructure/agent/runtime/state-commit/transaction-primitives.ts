import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type {
  DurableEventInput,
  LedgerAppendInput,
  RunProjectionPatch,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunEvent, RunStatus, RunUsage, RunView } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { appendHostEvent } from '../../events/host-event-outbox';
import { RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';

export const NON_TERMINAL = new Set<RunStatus>([
  'created',
  'running',
  'awaiting_approval',
  'awaiting_budget',
  'cancelling',
]);
export const COUNTED_LIVE = new Set<RunStatus>(['running', 'awaiting_approval', 'awaiting_budget', 'cancelling']);
export const CREATED_QUEUE_LIMIT = 20;
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const MAX_EVENTS_PER_COMMIT = 64;
const MAX_EVENT_BYTES_PER_COMMIT = 256 * 1024;

interface ThreadRow {
  next_sequence: number;
  version: number;
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

export const validateEvents = (events: readonly DurableEventInput[]): void => {
  if (events.length > MAX_EVENTS_PER_COMMIT || eventBytes(events) > MAX_EVENT_BYTES_PER_COMMIT) {
    throw new Error('AGENT_COMMIT_BATCH_TOO_LARGE');
  }
};

export const emptyUsage = (): RunUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  costMicros: 0,
  steps: 0,
  subagentMessages: 0,
  subagentMessageBytes: 0,
});

export const usageWithDelta = (
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

export const summaryPayload = (run: RunView): JsonValue => ({
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

export const allocateHostEvent = appendHostEvent;

export const updateAppLiveCount = async (
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

export const appendEvents = async (
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

export const appendLedger = async (
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

export const patchRun = async (
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

export const artifactForInput = async (
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
