import type {
  AppendLedgerEntry,
  ConversationRepositoryPort,
  JsonValue,
  LedgerEntryKind,
  LedgerEntryView,
  LedgerPage,
  Scope,
  ThreadDeleteAllResult,
  ThreadDeleteResult,
  ThreadPage,
  ThreadTitleSource,
  ThreadView,
} from '../../../modules/agent/ai/conversation.repository.port';
import type { ContextHistoryBoundary } from '../../../modules/agent/ai/context.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { appendHostEvent } from '../events/host-event-outbox';

interface ThreadRow {
  id: string;
  app_id: string;
  title: string;
  title_source: ThreadTitleSource;
  version: number;
  created_at: number;
  updated_at: number;
  latest_run_id: string | null;
}

interface EntryRow {
  id: string;
  thread_id: string;
  run_id: string | null;
  sequence: number;
  kind: LedgerEntryKind;
  payload_json: string;
  created_at: number;
}

const mapThread = (row: ThreadRow): ThreadView => ({
  id: row.id,
  appId: row.app_id,
  title: row.title,
  titleSource: row.title_source,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  latestRunId: row.latest_run_id,
});

const mapEntry = (row: EntryRow): LedgerEntryView => ({
  id: row.id,
  threadId: row.thread_id,
  runId: row.run_id,
  sequence: row.sequence,
  kind: row.kind,
  payload: JSON.parse(row.payload_json) as JsonValue,
  createdAt: row.created_at,
});

const encodeThreadCursor = (updatedAt: number, id: string): string =>
  Buffer.from(JSON.stringify({ updatedAt, id }), 'utf8').toString('base64url');

const decodeThreadCursor = (cursor: string): { updatedAt: number; id: string } => {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    if (!Number.isSafeInteger(value.updatedAt) || typeof value.id !== 'string' || !value.id) throw new Error('invalid');
    return { updatedAt: value.updatedAt as number, id: value.id };
  } catch {
    throw new Error('CURSOR_INVALID');
  }
};

const encodeEntryCursor = (sequence: number): string => Buffer.from(String(sequence), 'utf8').toString('base64url');

const decodeEntryCursor = (cursor: string): number => {
  const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('CURSOR_INVALID');
  return value;
};

const threadSelect = `
  SELECT t.id, t.app_id, t.title, t.title_source, t.version, t.created_at, t.updated_at,
    (SELECT r.id FROM agent_runs r WHERE r.thread_id = t.id AND r.user_id = t.user_id AND r.app_id = t.app_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_run_id
  FROM ai_threads t
`;

const nonTerminalRunSql = "'created','running','awaiting_approval','awaiting_budget','cancelling'";

const assertThreadDeleteSafe = async (db: RelationalDatabase, scope: Scope, threadId?: string): Promise<void> => {
  const threadFilter = threadId ? ' AND r.thread_id = ?' : '';
  const params: unknown[] = [scope.userId, scope.appId, ...(threadId ? [threadId] : [])];
  const active = await db.queryOne<{ id: string }>(
    `SELECT r.id FROM agent_runs r
     WHERE r.user_id = ? AND r.app_id = ?${threadFilter} AND r.status IN (${nonTerminalRunSql}) LIMIT 1`,
    params,
  );
  if (active) throw new Error('THREAD_DELETE_ACTIVE');

  const reconciliation = await db.queryOne<{ id: string }>(
    `SELECT r.id FROM agent_runs r
     WHERE r.user_id = ? AND r.app_id = ?${threadFilter} AND r.needs_reconciliation = 1 LIMIT 1`,
    params,
  );
  if (reconciliation) throw new Error('THREAD_DELETE_RECONCILIATION_REQUIRED');

  const workspace = await db.queryOne<{ id: string }>(
    `SELECT w.id FROM agent_workspaces w
     INNER JOIN agent_runs r ON r.id = w.run_id AND r.user_id = w.user_id AND r.app_id = w.app_id
     WHERE r.user_id = ? AND r.app_id = ?${threadFilter}
       AND (w.status <> 'deleted' OR w.retained = 1) LIMIT 1`,
    params,
  );
  if (workspace) throw new Error('THREAD_DELETE_WORKSPACE_ATTACHED');

  if (threadId) {
    const externallyReferenced = await db.queryOne<{ id: string }>(
      `SELECT child.id
       FROM agent_runs child
       INNER JOIN agent_runs parent
         ON parent.id = child.parent_run_id AND parent.user_id = child.user_id AND parent.app_id = child.app_id
       WHERE parent.user_id = ? AND parent.app_id = ? AND parent.thread_id = ? AND child.thread_id <> ? LIMIT 1`,
      [scope.userId, scope.appId, threadId, threadId],
    );
    if (externallyReferenced) throw new Error('THREAD_DELETE_REFERENCED');
  }
};

const cleanupThreadRunReferences = async (db: RelationalDatabase, scope: Scope, threadId?: string): Promise<void> => {
  const threadFilter = threadId ? ' AND thread_id = ?' : '';
  const params: unknown[] = [scope.userId, scope.appId, ...(threadId ? [threadId] : [])];
  await db.execute(
    `DELETE FROM agent_artifact_links
     WHERE run_id IN (SELECT id FROM agent_runs WHERE user_id = ? AND app_id = ?${threadFilter})`,
    params,
  );
  if (threadId) {
    await db.execute(
      'DELETE FROM agent_artifact_grants WHERE receiver_user_id = ? AND receiver_app_id = ? AND receiver_thread_id = ?',
      [scope.userId, scope.appId, threadId],
    );
    await db.execute('DELETE FROM ai_thread_entries WHERE user_id = ? AND app_id = ? AND thread_id = ?', [
      scope.userId,
      scope.appId,
      threadId,
    ]);
    await db.execute('DELETE FROM ai_context_digests WHERE thread_id = ?', [threadId]);
    await db.execute('UPDATE agent_runs SET parent_run_id = NULL WHERE user_id = ? AND app_id = ? AND thread_id = ?', [
      scope.userId,
      scope.appId,
      threadId,
    ]);
    return;
  }

  await db.execute('DELETE FROM agent_artifact_grants WHERE receiver_user_id = ? AND receiver_app_id = ?', [
    scope.userId,
    scope.appId,
  ]);
  await db.execute('DELETE FROM ai_thread_entries WHERE user_id = ? AND app_id = ?', [scope.userId, scope.appId]);
  await db.execute(
    'DELETE FROM ai_context_digests WHERE thread_id IN (SELECT id FROM ai_threads WHERE user_id = ? AND app_id = ?)',
    [scope.userId, scope.appId],
  );
  await db.execute('UPDATE agent_runs SET parent_run_id = NULL WHERE user_id = ? AND app_id = ?', [
    scope.userId,
    scope.appId,
  ]);
};

export class SqliteConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async createThread(
    scope: Scope,
    id: string,
    title: string,
    titleSource: ThreadTitleSource,
    now: number,
  ): Promise<ThreadView> {
    await this.db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, next_sequence, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [id, scope.userId, scope.appId, title, titleSource, now, now],
    );
    const created = await this.getThread(scope, id);
    if (!created) throw new Error('NOT_FOUND');
    return created;
  }

  async renameThread(
    scope: Scope,
    threadId: string,
    title: string,
    expectedVersion: number,
    now: number,
  ): Promise<ThreadView> {
    await this.db.transaction(async (tx) => {
      const current = await tx.queryOne<{ version: number }>(
        'SELECT version FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?',
        [threadId, scope.userId, scope.appId],
      );
      if (!current) throw new Error('NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('STATE_CONFLICT');
      const updated = await tx.execute(
        `UPDATE ai_threads SET title = ?, title_source = 'manual', version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
        [title, now, threadId, scope.userId, scope.appId, expectedVersion],
      );
      if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
      await appendHostEvent(
        tx,
        scope.userId,
        'thread.changed',
        {
          appId: scope.appId,
          threadId,
          title,
          titleSource: 'manual',
          version: expectedVersion + 1,
          updatedAt: now,
        },
        now,
      );
    });
    const renamed = await this.getThread(scope, threadId);
    if (!renamed) throw new Error('NOT_FOUND');
    return renamed;
  }

  async getThread(scope: Scope, threadId: string): Promise<ThreadView | null> {
    const row = await this.db.queryOne<ThreadRow>(`${threadSelect} WHERE t.id = ? AND t.user_id = ? AND t.app_id = ?`, [
      threadId,
      scope.userId,
      scope.appId,
    ]);
    return row ? mapThread(row) : null;
  }

  async listThreads(scope: Scope, limit: number, before?: string): Promise<ThreadPage> {
    const clauses = ['t.user_id = ?', 't.app_id = ?'];
    const parameters: unknown[] = [scope.userId, scope.appId];
    if (before) {
      const cursor = decodeThreadCursor(before);
      clauses.push('(t.updated_at < ? OR (t.updated_at = ? AND t.id < ?))');
      parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    parameters.push(limit + 1);
    const rows = await this.db.queryAll<ThreadRow>(
      `${threadSelect} WHERE ${clauses.join(' AND ')} ORDER BY t.updated_at DESC, t.id DESC LIMIT ?`,
      parameters,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapThread),
      nextCursor: rows.length > limit && last ? encodeThreadCursor(last.updated_at, last.id) : null,
    };
  }

  async deleteThread(
    scope: Scope,
    threadId: string,
    expectedVersion: number,
    now: number,
  ): Promise<ThreadDeleteResult> {
    await this.db.transaction(async (tx) => {
      const thread = await tx.queryOne<{ version: number }>(
        'SELECT version FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?',
        [threadId, scope.userId, scope.appId],
      );
      if (!thread) throw new Error('NOT_FOUND');
      if (thread.version !== expectedVersion) throw new Error('STATE_CONFLICT');
      await assertThreadDeleteSafe(tx, scope, threadId);
      await cleanupThreadRunReferences(tx, scope, threadId);
      const deleted = await tx.execute(
        'DELETE FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?',
        [threadId, scope.userId, scope.appId, expectedVersion],
      );
      if (deleted.changes !== 1) throw new Error('STATE_CONFLICT');
      await appendHostEvent(tx, scope.userId, 'thread.changed', { appId: scope.appId, threadId, deleted: true }, now);
      await appendHostEvent(tx, scope.userId, 'summary.changed', { appId: scope.appId, threadId, deleted: true }, now);
    });
    return { threadId, deleted: true };
  }

  async deleteAllThreads(scope: Scope, now: number): Promise<ThreadDeleteAllResult> {
    let deletedCount = 0;
    await this.db.transaction(async (tx) => {
      const count = await tx.queryOne<{ count: number }>(
        'SELECT COUNT(*) AS count FROM ai_threads WHERE user_id = ? AND app_id = ?',
        [scope.userId, scope.appId],
      );
      deletedCount = count?.count ?? 0;
      if (deletedCount === 0) return;
      await assertThreadDeleteSafe(tx, scope);
      await cleanupThreadRunReferences(tx, scope);
      const deleted = await tx.execute('DELETE FROM ai_threads WHERE user_id = ? AND app_id = ?', [
        scope.userId,
        scope.appId,
      ]);
      if (deleted.changes !== deletedCount) throw new Error('STATE_CONFLICT');
      await appendHostEvent(
        tx,
        scope.userId,
        'thread.changed',
        { appId: scope.appId, allDeleted: true, deletedCount },
        now,
      );
      await appendHostEvent(tx, scope.userId, 'summary.changed', { appId: scope.appId, allDeleted: true }, now);
    });
    return { deletedCount };
  }

  async readEntries(scope: Scope, threadId: string, limit: number, before?: string): Promise<LedgerPage> {
    if (!(await this.getThread(scope, threadId))) throw new Error('NOT_FOUND');
    const parameters: unknown[] = [threadId, scope.userId, scope.appId];
    let cursorClause = '';
    if (before) {
      cursorClause = ' AND sequence < ?';
      parameters.push(decodeEntryCursor(before));
    }
    parameters.push(limit + 1);
    const rows = await this.db.queryAll<EntryRow>(
      `SELECT id, thread_id, run_id, sequence, kind, payload_json, created_at
       FROM ai_thread_entries
       WHERE thread_id = ? AND user_id = ? AND app_id = ?${cursorClause}
       ORDER BY sequence DESC LIMIT ?`,
      parameters,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(mapEntry).reverse(),
      nextCursor: rows.length > limit && last ? encodeEntryCursor(last.sequence) : null,
    };
  }

  async readOldestEntries(scope: Scope, threadId: string, limit: number): Promise<LedgerPage> {
    if (!(await this.getThread(scope, threadId))) throw new Error('NOT_FOUND');
    const rows = await this.db.queryAll<EntryRow>(
      `SELECT id, thread_id, run_id, sequence, kind, payload_json, created_at
       FROM ai_thread_entries
       WHERE thread_id = ? AND user_id = ? AND app_id = ?
       ORDER BY sequence ASC LIMIT ?`,
      [threadId, scope.userId, scope.appId, limit],
    );
    return { items: rows.map(mapEntry), nextCursor: null };
  }

  async readContextEntries(
    scope: Scope,
    threadId: string,
    runId: string,
    historyBoundary: ContextHistoryBoundary,
    limit: number,
  ): Promise<LedgerPage> {
    if (!(await this.getThread(scope, threadId))) throw new Error('NOT_FOUND');
    const inherited = Object.entries(historyBoundary.runThrough);
    const clauses = ['sequence <= ?', 'run_id = ?', ...inherited.map(() => '(run_id = ? AND sequence <= ?)')];
    const parameters: unknown[] = [
      threadId,
      scope.userId,
      scope.appId,
      historyBoundary.baseThrough,
      runId,
      ...inherited.flatMap(([historyRunId, through]) => [historyRunId, through]),
      limit,
    ];
    const rows = await this.db.queryAll<EntryRow>(
      `SELECT id, thread_id, run_id, sequence, kind, payload_json, created_at
       FROM ai_thread_entries
       WHERE thread_id = ? AND user_id = ? AND app_id = ?
         AND (${clauses.join(' OR ')})
       ORDER BY sequence DESC LIMIT ?`,
      parameters,
    );
    return { items: rows.map(mapEntry).reverse(), nextCursor: null };
  }

  async appendEntry(scope: Scope, threadId: string, entry: AppendLedgerEntry): Promise<LedgerEntryView> {
    let sequence = 0;
    await this.db.transaction(async (tx) => {
      const thread = await tx.queryOne<{ next_sequence: number; version: number }>(
        'SELECT next_sequence, version FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?',
        [threadId, scope.userId, scope.appId],
      );
      if (!thread) throw new Error('NOT_FOUND');
      sequence = thread.next_sequence;
      const updated = await tx.execute(
        `UPDATE ai_threads SET next_sequence = next_sequence + 1, version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
        [entry.createdAt, threadId, scope.userId, scope.appId, thread.version],
      );
      if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
      await tx.execute(
        `INSERT INTO ai_thread_entries
          (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          threadId,
          scope.userId,
          scope.appId,
          entry.runId ?? null,
          sequence,
          entry.kind,
          JSON.stringify(entry.payload),
          entry.createdAt,
        ],
      );
    });
    return {
      id: entry.id,
      threadId,
      runId: entry.runId ?? null,
      sequence,
      kind: entry.kind,
      payload: entry.payload,
      createdAt: entry.createdAt,
    };
  }
}
