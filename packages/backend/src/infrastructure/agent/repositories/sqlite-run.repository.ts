import type { JsonValue } from '../../../modules/agent/agent.types';
import type { ToolInspection } from '../../../modules/agent/capabilities/tool.types';
import type { HostEvent, RunEvent, RunSnapshot } from '../../../modules/agent/runtime/runs/run.types';
import type {
  PendingMutationTool,
  RunPage,
  RunRepositoryPort,
  Scope,
} from '../../../modules/agent/runtime/runs/run.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from './sqlite-run.mapper';

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

interface PendingMutationRow {
  tool_call_id: string;
  step_id: string;
  agent_runtime_id: string;
  provider_call_id: string;
  approval_id: string;
  approval_version: number;
  inspection_json: string;
}

const encodeCursor = (createdAt: number, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');

const decodeCursor = (cursor: string): { createdAt: number; id: string } => {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (!Number.isSafeInteger(value.createdAt) || typeof value.id !== 'string' || !value.id) throw new Error('invalid');
    return { createdAt: value.createdAt as number, id: value.id };
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
  payload: JSON.parse(row.payload_json) as JsonValue,
  occurredAt: row.occurred_at,
});

export class SqliteRunRepository implements RunRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async snapshot(scope: Scope, runId: string): Promise<RunSnapshot | null> {
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
        [runId, scope.userId, scope.appId],
      );
      if (!row) return null;
      const entries = await tx.queryAll<EntryRow>(
        `SELECT id, sequence, kind, payload_json, created_at
         FROM ai_thread_entries
         WHERE thread_id = ? AND user_id = ? AND app_id = ?
         ORDER BY sequence DESC LIMIT 50`,
        [row.thread_id, scope.userId, scope.appId],
      );
      return {
        ...mapRunRow(row),
        recentEntries: entries.reverse().map((entry) => ({
          id: entry.id,
          sequence: entry.sequence,
          kind: entry.kind,
          payload: JSON.parse(entry.payload_json) as JsonValue,
          createdAt: entry.created_at,
        })),
      };
    });
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
      payload: JSON.parse(row.payload_json) as JsonValue,
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

  async pendingMutation(scope: Scope, runId: string): Promise<PendingMutationTool | null> {
    const row = await this.db.queryOne<PendingMutationRow>(
      `SELECT t.id AS tool_call_id, t.step_id, t.agent_runtime_id, t.provider_call_id,
              a.id AS approval_id, a.version AS approval_version, t.inspection_json
       FROM agent_tool_calls t
       JOIN agent_runs r ON r.id = t.run_id
       JOIN agent_approvals a ON a.tool_call_id = t.id AND a.run_id = t.run_id
       WHERE t.run_id = ? AND r.user_id = ? AND r.app_id = ?
         AND t.status = 'ready' AND t.risk <> 'read'
         AND a.status = 'approved' AND a.consumed_at IS NULL
       ORDER BY t.created_at, t.id LIMIT 1`,
      [runId, scope.userId, scope.appId],
    );
    if (!row) return null;
    return {
      toolCallId: row.tool_call_id,
      stepId: row.step_id,
      runtimeId: row.agent_runtime_id,
      providerCallId: row.provider_call_id,
      approvalId: row.approval_id,
      approvalVersion: row.approval_version,
      inspection: JSON.parse(row.inspection_json) as ToolInspection,
    };
  }

  async createdQueue(limit: number): Promise<ReturnType<typeof mapRunRow>[]> {
    const rows = await this.db.queryAll<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE status = 'created' ORDER BY created_at, id LIMIT ?`,
      [limit],
    );
    return rows.map(mapRunRow);
  }
}
