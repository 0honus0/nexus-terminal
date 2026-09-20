import type {
  PendingRunInputPage,
  HostEvent,
  PendingUserInputRequest,
  RunEvent,
  RunInputProjection,
  RunReconciliationView,
  RunSnapshot,
} from '../../../modules/agent/runtime/runs/run.types';
import { normalizeUserInputQuestions } from '../../../modules/agent/runtime/runs/user-input-request';
import type {
  CompletionEvidenceSnapshot,
  ConfirmedMutationTool,
  HostCursorReaderPort,
  PendingRootTool,
  PendingToolInputContinuation,
  RunEventReaderPort,
  RunExecutionReaderPort,
  RunPage,
  RunQueryPort,
  Scope,
} from '../../../modules/agent/runtime/runs/run.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import {
  durableInteger,
  durableRecord,
  durableString,
  parseDurableJson,
  parseDurableJsonValue,
  parseToolInspection,
  parseToolResult,
} from '../runtime/durable-state-decoders';
import { mapRunRow, RUN_COLUMNS, type RunRow } from './sqlite-run.mapper';
import { projectRunUserInputs } from './run-input-projection';

interface EntryRow {
  id: string;
  sequence: number;
  kind: string;
  payload_json: string;
  created_at: number;
}

interface EventRow {
  event_id: string;
  run_id: string;
  sequence: number;
  schema_version: 1;
  type: string;
  payload_json: string;
  occurred_at: number;
}

interface HostEventRow {
  user_id: number;
  sequence: number;
  type: string;
  payload_json: string;
  occurred_at: number;
}

interface PendingRootToolRow {
  tool_call_id: string;
  step_id: string;
  agent_runtime_id: string;
  provider_call_id: string;
  status: 'proposed' | 'ready';
  approval_id: string | null;
  approval_version: number | null;
  inspection_json: string;
}

interface ReconciliationResourceRow {
  resource_key: string;
  tool_call_id: string | null;
  reason: string;
  version: number;
  created_at: number;
}

interface CompletionToolRow {
  tool_call_id: string;
  step_index: number;
  tool_name: string;
  inspection_json: string;
  result_json: string;
}

interface PendingUserInputRequestRow {
  id: string;
  agent_runtime_id: string;
  questions_json: string;
  requested_at: number;
}

const mapPendingUserInputRequest = (row: PendingUserInputRequestRow | null): PendingUserInputRequest | null =>
  row
    ? {
        id: row.id,
        runtimeId: row.agent_runtime_id,
        questions: normalizeUserInputQuestions(parseDurableJson(row.questions_json)),
        requestedAt: row.requested_at,
      }
    : null;

const encodeCursor = (createdAt: number, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');

const decodeCursor = (cursor: string): { createdAt: number; id: string } => {
  try {
    const value = durableRecord(parseDurableJson(Buffer.from(cursor, 'base64url').toString('utf8')));
    const id = durableString(value.id) as string;
    if (!id) throw new Error('invalid');
    return { createdAt: durableInteger(value.createdAt), id };
  } catch {
    throw new Error('CURSOR_INVALID');
  }
};

const mapEvent = (row: EventRow): RunEvent => ({
  eventId: row.event_id,
  runId: row.run_id,
  sequence: row.sequence,
  schemaVersion: 1,
  type: row.type,
  payload: parseDurableJsonValue(row.payload_json),
  occurredAt: row.occurred_at,
});

export class SqliteRunRepository
  implements RunQueryPort, RunEventReaderPort, HostCursorReaderPort, RunExecutionReaderPort
{
  constructor(private readonly db: RelationalDatabase) {}

  async snapshot(scope: Scope, runId: string): Promise<RunSnapshot | null> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [runId, scope.userId, scope.appId],
      );
      if (!row) return null;
      const run = mapRunRow(row);
      const historyBoundary = run.definition.contextBoundary;
      const inherited = historyBoundary ? Object.entries(historyBoundary.runThrough) : [];
      const historyClause = historyBoundary
        ? `AND (${['sequence <= ?', 'run_id = ?', ...inherited.map(() => '(run_id = ? AND sequence <= ?)')].join(' OR ')})`
        : '';
      const [entries, issueRow, pendingInputRequestRow] = await Promise.all([
        tx.queryAll<EntryRow>(
          `SELECT id, sequence, kind, payload_json, created_at
           FROM ai_thread_entries
           WHERE thread_id = ? AND user_id = ? AND app_id = ?
             ${historyClause}
           ORDER BY sequence DESC LIMIT 50`,
          historyBoundary
            ? [
                row.thread_id,
                scope.userId,
                scope.appId,
                historyBoundary.baseThrough,
                row.id,
                ...inherited.flatMap(([historyRunId, through]) => [historyRunId, through]),
              ]
            : [row.thread_id, scope.userId, scope.appId],
        ),
        ['failed', 'interrupted', 'cancelled'].includes(run.status)
          ? tx.queryOne<EventRow>(
              `SELECT event_id, run_id, sequence, schema_version, type, payload_json, occurred_at
               FROM agent_events
               WHERE run_id = ? AND type IN ('model.failed','tool.failed','run.interrupted','run.cancelled')
               ORDER BY sequence DESC LIMIT 1`,
              [row.id],
            )
          : Promise.resolve(null),
        run.status === 'awaiting_input'
          ? tx.queryOne<PendingUserInputRequestRow>(
              `SELECT id, agent_runtime_id, questions_json, requested_at
               FROM agent_input_requests
               WHERE run_id = ? AND user_id = ? AND app_id = ? AND status = 'requested'
               ORDER BY requested_at DESC, id DESC LIMIT 1`,
              [row.id, scope.userId, scope.appId],
            )
          : Promise.resolve(null),
      ]);
      const issuePayload = issueRow ? durableRecord(parseDurableJsonValue(issueRow.payload_json)) : null;
      return {
        ...run,
        pendingInputRequest: mapPendingUserInputRequest(pendingInputRequestRow),
        terminalIssue: issueRow
          ? {
              eventType: issueRow.type,
              errorCode: typeof issuePayload?.errorCode === 'string' ? issuePayload.errorCode : null,
              reason:
                typeof issuePayload?.reason === 'string'
                  ? issuePayload.reason
                  : typeof issuePayload?.summary === 'string'
                    ? issuePayload.summary
                    : null,
              occurredAt: issueRow.occurred_at,
            }
          : null,
        recentEntries: entries.reverse().map((entry) => ({
          id: entry.id,
          sequence: entry.sequence,
          kind: entry.kind,
          payload: parseDurableJsonValue(entry.payload_json),
          createdAt: entry.created_at,
        })),
      };
    });
  }

  async inputProjection(scope: Scope, runId: string): Promise<RunInputProjection> {
    return this.db.transaction(async (tx) => {
      const run = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [runId, scope.userId, scope.appId],
      );
      if (!run) throw new Error('NOT_FOUND');
      const ordered = await projectRunUserInputs(tx, scope, runId);
      return { ordered, pending: ordered.filter((entry) => entry.sequence > run.consumed_input_sequence) };
    });
  }

  async pendingInputs(scope: Scope, runId: string, limit: number): Promise<PendingRunInputPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
    const projection = await this.inputProjection(scope, runId);
    return {
      items: projection.pending.slice(0, limit),
      total: projection.pending.length,
      hasMore: projection.pending.length > limit,
    };
  }

  async reconciliation(scope: Scope, runId: string): Promise<RunReconciliationView> {
    const run = await this.db.queryOne<{ id: string; needs_reconciliation: number }>(
      'SELECT id, needs_reconciliation FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?',
      [runId, scope.userId, scope.appId],
    );
    if (!run) throw new Error('NOT_FOUND');
    const resources = await this.db.queryAll<ReconciliationResourceRow>(
      `SELECT q.resource_key, q.tool_call_id, q.reason, q.version, q.created_at
       FROM agent_resource_quarantine q
       JOIN agent_runtimes rt ON rt.id = q.owner_id AND q.owner_type = 'agent'
       WHERE rt.run_id = ?
       ORDER BY q.created_at, q.resource_key`,
      [runId],
    );
    return {
      runId,
      required: run.needs_reconciliation === 1,
      resources: resources.map((row) => ({
        resourceKey: row.resource_key,
        toolCallId: row.tool_call_id,
        reason: row.reason,
        version: row.version,
        createdAt: row.created_at,
      })),
    };
  }

  async list(scope: Scope, threadId: string | undefined, limit: number, before?: string): Promise<RunPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
    const clauses = ['user_id = ?', 'app_id = ?'];
    const parameters: unknown[] = [scope.userId, scope.appId];
    if (threadId) {
      clauses.push('thread_id = ?');
      parameters.push(threadId);
    }
    if (before) {
      const cursor = decodeCursor(before);
      clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    parameters.push(limit + 1);
    const rows = await this.db.queryAll<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs
       WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      parameters,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapRunRow),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async readEvents(scope: Scope, runId: string, after: number, limit: number): Promise<RunEvent[]> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('VALIDATION_FAILED');
    }
    const owned = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?',
      [runId, scope.userId, scope.appId],
    );
    if (!owned) throw new Error('NOT_FOUND');
    const rows = await this.db.queryAll<EventRow>(
      `SELECT event_id, run_id, sequence, schema_version, type, payload_json, occurred_at
       FROM agent_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`,
      [runId, after, limit],
    );
    return rows.map(mapEvent);
  }

  async readHostEvents(userId: number, after: number, limit: number): Promise<HostEvent[]> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('VALIDATION_FAILED');
    }
    const rows = await this.db.queryAll<HostEventRow>(
      `SELECT user_id, sequence, type, payload_json, occurred_at
       FROM agent_host_events WHERE user_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`,
      [userId, after, limit],
    );
    return rows.map((row) => ({
      userId: row.user_id,
      sequence: row.sequence,
      type: row.type,
      payload: parseDurableJsonValue(row.payload_json),
      occurredAt: row.occurred_at,
    }));
  }

  async hostCursor(userId: number): Promise<number> {
    const row = await this.db.queryOne<{ next_sequence: number }>(
      'SELECT next_sequence FROM agent_host_cursors WHERE user_id = ?',
      [userId],
    );
    return (row?.next_sequence ?? 1) - 1;
  }

  async rootRuntimeId(scope: Scope, runId: string): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT rt.id FROM agent_runtimes rt
       JOIN agent_runs r ON r.id = rt.run_id
       WHERE rt.run_id = ? AND rt.participant_id = 'root' AND r.user_id = ? AND r.app_id = ?`,
      [runId, scope.userId, scope.appId],
    );
    if (!row) throw new Error('NOT_FOUND');
    return row.id;
  }

  async rootRuntimeModel(
    scope: Scope,
    runId: string,
  ): Promise<import('../../../modules/agent/ai/model.types').ModelRef> {
    const row = await this.db.queryOne<{ model_ref_json: string }>(
      `SELECT rt.model_ref_json FROM agent_runtimes rt
       JOIN agent_runs r ON r.id = rt.run_id
       WHERE rt.run_id = ? AND rt.participant_id = 'root' AND r.user_id = ? AND r.app_id = ? LIMIT 1`,
      [runId, scope.userId, scope.appId],
    );
    if (!row) throw new Error('RUNTIME_NOT_FOUND');
    const record = parseDurableJsonValue(row.model_ref_json);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('DURABLE_STATE_INVALID');
    const model = record as Record<string, unknown>;
    if (
      typeof model.providerId !== 'string' ||
      typeof model.modelId !== 'string' ||
      !Number.isSafeInteger(model.configurationVersion)
    ) {
      throw new Error('DURABLE_STATE_INVALID');
    }
    return {
      providerId: model.providerId,
      modelId: model.modelId,
      configurationVersion: model.configurationVersion as number,
    };
  }

  async pendingTools(scope: Scope, runId: string): Promise<PendingRootTool[]> {
    const rows = await this.db.queryAll<PendingRootToolRow>(
      `SELECT t.id AS tool_call_id, t.step_id, t.agent_runtime_id, t.provider_call_id, t.status,
              a.id AS approval_id, a.version AS approval_version, t.inspection_json
       FROM agent_tool_calls t
       JOIN agent_runs r ON r.id = t.run_id
       JOIN agent_steps s ON s.id = t.step_id AND s.run_id = t.run_id
       LEFT JOIN agent_approvals a ON a.tool_call_id = t.id AND a.run_id = t.run_id
         AND a.status = 'approved' AND a.consumed_at IS NULL
       WHERE t.run_id = ? AND r.user_id = ? AND r.app_id = ?
         AND t.status IN ('proposed','ready')
       ORDER BY s.step_index, t.created_at, t.id LIMIT 64`,
      [runId, scope.userId, scope.appId],
    );
    return rows.map((row) => {
      if (row.status === 'ready' && (!row.approval_id || row.approval_version === null)) {
        throw new Error('APPROVAL_STATE_INVALID');
      }
      return {
        toolCallId: row.tool_call_id,
        stepId: row.step_id,
        runtimeId: row.agent_runtime_id,
        providerCallId: row.provider_call_id,
        status: row.status,
        approvalId: row.approval_id,
        approvalVersion: row.approval_version,
        inspection: parseToolInspection(row.inspection_json),
      };
    });
  }

  async inputContinuationForTool(
    scope: Scope,
    runId: string,
    toolCallId: string,
  ): Promise<PendingToolInputContinuation | null> {
    const row = await this.db.queryOne<{
      request_id: string;
      continuation_json: string;
      payload_json: string;
    }>(
      `SELECT r.id AS request_id, r.continuation_json, e.payload_json
       FROM agent_input_requests r
       JOIN agent_runs run ON run.id = r.run_id
       JOIN ai_thread_entries e ON e.id = r.answer_entry_id AND e.run_id = r.run_id
       WHERE r.run_id = ? AND r.tool_call_id = ? AND r.status = 'answered'
         AND r.continuation_json IS NOT NULL
         AND run.user_id = ? AND run.app_id = ?
       ORDER BY r.answered_at DESC, r.id DESC LIMIT 1`,
      [runId, toolCallId, scope.userId, scope.appId],
    );
    if (!row) return null;
    const payload = durableRecord(parseDurableJson(row.payload_json));
    const answerText = durableString(payload.text);
    if (!answerText) throw new Error('DURABLE_STATE_INVALID');
    return {
      requestId: row.request_id,
      continuation: parseDurableJsonValue(row.continuation_json),
      answerText,
    };
  }

  async confirmedMutation(scope: Scope, runId: string, operationHash: string): Promise<ConfirmedMutationTool | null> {
    const row = await this.db.queryOne<{ tool_call_id: string; provider_call_id: string }>(
      `SELECT t.id AS tool_call_id, t.provider_call_id
       FROM agent_tool_calls t
       JOIN agent_runs r ON r.id = t.run_id
       WHERE t.run_id = ? AND r.user_id = ? AND r.app_id = ?
         AND t.operation_hash = ? AND t.status = 'succeeded' AND t.risk <> 'read'
       ORDER BY t.completed_at, t.created_at, t.id LIMIT 1`,
      [runId, scope.userId, scope.appId, operationHash],
    );
    return row ? { toolCallId: row.tool_call_id, providerCallId: row.provider_call_id } : null;
  }

  async completionEvidence(scope: Scope, runId: string): Promise<CompletionEvidenceSnapshot> {
    const owned = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?',
      [runId, scope.userId, scope.appId],
    );
    if (!owned) throw new Error('NOT_FOUND');
    const rows = await this.db.queryAll<CompletionToolRow>(
      `SELECT t.id AS tool_call_id, s.step_index, t.tool_name, t.inspection_json, t.result_json
       FROM agent_tool_calls t
       JOIN agent_steps s ON s.id = t.step_id AND s.run_id = t.run_id
       WHERE t.run_id = ? AND t.result_json IS NOT NULL
       ORDER BY s.step_index, t.completed_at, t.id`,
      [runId],
    );
    const readyEvidence = await this.db.queryAll<{ artifact_id: string }>(
      `SELECT l.artifact_id FROM agent_artifact_links l
       JOIN ai_artifacts a ON a.id = l.artifact_id
       WHERE l.run_id = ? AND l.role = 'evidence' AND a.user_id = ? AND a.app_id = ? AND a.status = 'ready'
       ORDER BY l.artifact_id`,
      [runId, scope.userId, scope.appId],
    );
    const latestToolProgress = await this.db.queryOne<{ sequence: number | null }>(
      `SELECT MAX(sequence) AS sequence FROM agent_events
       WHERE run_id = ? AND type IN ('tool.completed','tool.failed','tool.reconciliation_required')`,
      [runId],
    );
    const gateBlocks = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_events
       WHERE run_id = ? AND type = 'completion.gate_blocked' AND sequence > ?`,
      [runId, latestToolProgress?.sequence ?? 0],
    );
    return {
      tools: rows.map((row) => ({
        toolCallId: row.tool_call_id,
        stepIndex: row.step_index,
        toolName: row.tool_name,
        inspection: parseToolInspection(row.inspection_json),
        result: parseToolResult(row.result_json),
      })),
      readyEvidenceRefs: readyEvidence.map((row) => row.artifact_id),
      gateBlocksSinceToolProgress: gateBlocks?.count ?? 0,
    };
  }
}
