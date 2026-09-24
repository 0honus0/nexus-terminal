import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
import type {
  MemoryImportCommitResult,
  MemoryImportConfirmation,
  MemoryRepositoryPort,
  MemoryReviewAction,
  MemoryStatus,
  MemoryView,
} from '../../../modules/agent/ai/memory.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { appendHostEvent } from '../events/host-event-outbox';
import { parseDurableJsonValue } from '../runtime/durable-state-decoders';

interface MemoryRow {
  id: string;
  user_id: number;
  app_id: string;
  content: string;
  source_refs_json: string;
  confidence: number;
  status: MemoryStatus;
  expires_at: number | null;
  proposed_by_runtime_id: string | null;
  review_action: MemoryReviewAction | null;
  reviewed_at: number | null;
  version: number;
  created_at: number;
  updated_at: number;
}

interface ConfirmationRow {
  id: string;
  user_id: number;
  source_app_id: string;
  source_memory_id: string;
  target_app_id: string;
  source_version: number;
  snapshot_json: string;
  created_at: number;
  expires_at: number;
}

const MEMORY_COLUMNS = `id, user_id, app_id, content, source_refs_json, confidence, status, expires_at,
  proposed_by_runtime_id, review_action, reviewed_at, version, created_at, updated_at`;

const mapMemory = (row: MemoryRow): MemoryView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  content: row.content,
  sourceRefs: parseDurableJsonValue(row.source_refs_json),
  confidence: row.confidence,
  status: row.status,
  expiresAt: row.expires_at,
  proposedByRuntimeId: row.proposed_by_runtime_id,
  reviewAction: row.review_action,
  reviewedAt: row.reviewed_at,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class SqliteMemoryRepository implements MemoryRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async get(scope: Scope, id: string): Promise<MemoryView | null> {
    const row = await this.db.queryOne<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM ai_memories WHERE id = ? AND user_id = ? AND app_id = ?`,
      [id, scope.userId, scope.appId],
    );
    return row ? mapMemory(row) : null;
  }

  async getOwned(userId: number, appId: string, id: string): Promise<MemoryView | null> {
    return this.get({ userId, appId }, id);
  }

  async list(scope: Scope, status: MemoryStatus | 'all', limit: number): Promise<MemoryView[]> {
    const rows = await this.db.queryAll<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM ai_memories
       WHERE user_id = ? AND app_id = ?${status === 'all' ? '' : ' AND status = ?'}
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      status === 'all' ? [scope.userId, scope.appId, limit] : [scope.userId, scope.appId, status, limit],
    );
    return rows.map(mapMemory);
  }

  async propose(record: {
    id: string;
    scope: Scope;
    content: string;
    sourceRefs: JsonValue;
    confidence: number;
    expiresAt: number | null;
    proposedByRuntimeId: string | null;
    now: number;
  }): Promise<MemoryView> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO ai_memories
          (id, user_id, app_id, content, source_refs_json, confidence, status, expires_at,
           proposed_by_runtime_id, review_action, reviewed_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, NULL, NULL, 1, ?, ?)`,
        [
          record.id,
          record.scope.userId,
          record.scope.appId,
          record.content,
          JSON.stringify(record.sourceRefs),
          record.confidence,
          record.expiresAt,
          record.proposedByRuntimeId,
          record.now,
          record.now,
        ],
      );
      const created = await tx.queryOne<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM ai_memories WHERE id = ? AND user_id = ? AND app_id = ?`,
        [record.id, record.scope.userId, record.scope.appId],
      );
      if (!created) throw new Error('MEMORY_NOT_FOUND');
      const memory = mapMemory(created);
      await appendHostEvent(
        tx,
        record.scope.userId,
        'memory.changed',
        { appId: record.scope.appId, memoryId: record.id, status: memory.status, action: 'proposed' },
        record.now,
      );
      return memory;
    });
  }

  async review(record: {
    scope: Scope;
    id: string;
    expectedVersion: number;
    decision: MemoryReviewAction;
    content?: string;
    now: number;
  }): Promise<MemoryView> {
    return this.db.transaction(async (tx) => {
      const current = await tx.queryOne<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM ai_memories WHERE id = ? AND user_id = ? AND app_id = ?`,
        [record.id, record.scope.userId, record.scope.appId],
      );
      if (!current) throw new Error('MEMORY_NOT_FOUND');
      if (current.version !== record.expectedVersion) throw new Error('MEMORY_VERSION_CONFLICT');
      if (record.decision === 'publish' && current.status !== 'candidate')
        throw new Error('MEMORY_REVIEW_STATE_INVALID');
      if (record.decision === 'reject' && current.status !== 'candidate')
        throw new Error('MEMORY_REVIEW_STATE_INVALID');
      if (record.decision === 'revoke' && current.status !== 'published')
        throw new Error('MEMORY_REVIEW_STATE_INVALID');
      const nextStatus: MemoryStatus = record.decision === 'publish' ? 'published' : 'revoked';
      const content = record.content ?? current.content;
      const updated = await tx.execute(
        `UPDATE ai_memories SET content = ?, status = ?, review_action = ?, reviewed_at = ?,
         version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
        [
          content,
          nextStatus,
          record.decision,
          record.now,
          record.now,
          record.id,
          record.scope.userId,
          record.scope.appId,
          record.expectedVersion,
        ],
      );
      if (updated.changes !== 1) throw new Error('MEMORY_VERSION_CONFLICT');
      const result = await tx.queryOne<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM ai_memories WHERE id = ? AND user_id = ? AND app_id = ?`,
        [record.id, record.scope.userId, record.scope.appId],
      );
      if (!result) throw new Error('MEMORY_NOT_FOUND');
      const memory = mapMemory(result);
      await appendHostEvent(
        tx,
        record.scope.userId,
        'memory.changed',
        { appId: record.scope.appId, memoryId: record.id, status: memory.status, action: record.decision },
        record.now,
      );
      return memory;
    });
  }

  async saveImportConfirmation(record: MemoryImportConfirmation): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_memory_import_confirmations
        (id, user_id, source_app_id, source_memory_id, target_app_id, source_version, snapshot_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.userId,
        record.sourceAppId,
        record.sourceMemoryId,
        record.appId,
        record.sourceVersion,
        JSON.stringify(record.snapshot),
        record.createdAt,
        record.expiresAt,
      ],
    );
  }

  async confirmImport(record: {
    scope: Scope;
    confirmationId: string;
    memoryId: string;
    now: number;
  }): Promise<MemoryImportCommitResult> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM ai_memories WHERE id = ? AND user_id = ? AND app_id = ?`,
        [record.memoryId, record.scope.userId, record.scope.appId],
      );
      if (existing) {
        const memory = mapMemory(existing);
        const refs =
          memory.sourceRefs && typeof memory.sourceRefs === 'object' && !Array.isArray(memory.sourceRefs)
            ? (memory.sourceRefs as Record<string, JsonValue>)
            : null;
        if (
          refs?.kind !== 'cross_app_import' ||
          refs.importConfirmationId !== record.confirmationId ||
          typeof refs.sourceAppId !== 'string' ||
          typeof refs.sourceMemoryId !== 'string'
        ) {
          throw new Error('MEMORY_IMPORT_RESULT_CONFLICT');
        }
        return {
          memory,
          sourceAppId: refs.sourceAppId,
          sourceMemoryId: refs.sourceMemoryId,
          replayed: true,
        };
      }

      const row = await tx.queryOne<ConfirmationRow>(
        `SELECT id, user_id, source_app_id, source_memory_id, target_app_id, source_version,
                snapshot_json, created_at, expires_at
         FROM agent_memory_import_confirmations
         WHERE id = ? AND user_id = ? AND target_app_id = ?`,
        [record.confirmationId, record.scope.userId, record.scope.appId],
      );
      if (!row) throw new Error('MEMORY_IMPORT_CONFIRMATION_NOT_FOUND');
      if (row.expires_at <= record.now) throw new Error('MEMORY_IMPORT_CONFIRMATION_EXPIRED');

      const sourceRow = await tx.queryOne<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM ai_memories WHERE id = ? AND user_id = ? AND app_id = ?`,
        [row.source_memory_id, record.scope.userId, row.source_app_id],
      );
      if (
        !sourceRow ||
        sourceRow.status !== 'published' ||
        sourceRow.version !== row.source_version ||
        (sourceRow.expires_at !== null && sourceRow.expires_at <= record.now)
      ) {
        throw new Error('MEMORY_IMPORT_SOURCE_CHANGED');
      }
      const source = mapMemory(sourceRow);
      const sourceRefs: JsonValue = {
        kind: 'cross_app_import',
        importConfirmationId: record.confirmationId,
        sourceAppId: row.source_app_id,
        sourceMemoryId: source.id,
        sourceVersion: source.version,
        sourceRefs: source.sourceRefs,
      };
      await tx.execute(
        `INSERT INTO ai_memories
          (id, user_id, app_id, content, source_refs_json, confidence, status, expires_at,
           proposed_by_runtime_id, review_action, reviewed_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'published', ?, NULL, 'publish', ?, 1, ?, ?)`,
        [
          record.memoryId,
          record.scope.userId,
          record.scope.appId,
          source.content,
          JSON.stringify(sourceRefs),
          source.confidence,
          source.expiresAt,
          record.now,
          record.now,
          record.now,
        ],
      );
      const deleted = await tx.execute(
        'DELETE FROM agent_memory_import_confirmations WHERE id = ? AND user_id = ? AND target_app_id = ?',
        [record.confirmationId, record.scope.userId, record.scope.appId],
      );
      if (deleted.changes !== 1) throw new Error('MEMORY_IMPORT_CONFIRMATION_CONFLICT');
      const created = await tx.queryOne<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM ai_memories WHERE id = ? AND user_id = ? AND app_id = ?`,
        [record.memoryId, record.scope.userId, record.scope.appId],
      );
      if (!created) throw new Error('MEMORY_NOT_FOUND');
      const memory = mapMemory(created);
      await appendHostEvent(
        tx,
        record.scope.userId,
        'memory.changed',
        { appId: record.scope.appId, memoryId: record.memoryId, status: memory.status, action: 'imported' },
        record.now,
      );
      return {
        memory,
        sourceAppId: row.source_app_id,
        sourceMemoryId: row.source_memory_id,
        replayed: false,
      };
    });
  }

  async deleteExpiredImportConfirmations(now: number): Promise<number> {
    const result = await this.db.execute('DELETE FROM agent_memory_import_confirmations WHERE expires_at <= ?', [now]);
    return result.changes;
  }
}
