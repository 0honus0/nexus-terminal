import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
import type {
  MemoryImportConfirmation,
  MemoryRepositoryPort,
  MemoryReviewAction,
  MemoryStatus,
  MemoryView,
} from '../../../modules/agent/ai/memory.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

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
  sourceRefs: JSON.parse(row.source_refs_json) as JsonValue,
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

const mapConfirmation = (row: ConfirmationRow): MemoryImportConfirmation => ({
  id: row.id,
  userId: row.user_id,
  appId: row.target_app_id,
  sourceAppId: row.source_app_id,
  sourceMemoryId: row.source_memory_id,
  sourceVersion: row.source_version,
  snapshot: JSON.parse(row.snapshot_json) as JsonValue,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
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
    await this.db.execute(
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
    const created = await this.get(record.scope, record.id);
    if (!created) throw new Error('MEMORY_NOT_FOUND');
    return created;
  }

  async importPublished(record: {
    id: string;
    scope: Scope;
    content: string;
    sourceRefs: JsonValue;
    confidence: number;
    expiresAt: number | null;
    now: number;
  }): Promise<MemoryView> {
    await this.db.execute(
      `INSERT INTO ai_memories
        (id, user_id, app_id, content, source_refs_json, confidence, status, expires_at,
         proposed_by_runtime_id, review_action, reviewed_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published', ?, NULL, 'publish', ?, 1, ?, ?)`,
      [
        record.id,
        record.scope.userId,
        record.scope.appId,
        record.content,
        JSON.stringify(record.sourceRefs),
        record.confidence,
        record.expiresAt,
        record.now,
        record.now,
        record.now,
      ],
    );
    const created = await this.get(record.scope, record.id);
    if (!created) throw new Error('MEMORY_NOT_FOUND');
    return created;
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
      return mapMemory(result);
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

  async getImportConfirmation(scope: Scope, confirmationId: string): Promise<MemoryImportConfirmation | null> {
    const row = await this.db.queryOne<ConfirmationRow>(
      `SELECT id, user_id, source_app_id, source_memory_id, target_app_id, source_version,
              snapshot_json, created_at, expires_at
       FROM agent_memory_import_confirmations
       WHERE id = ? AND user_id = ? AND target_app_id = ?`,
      [confirmationId, scope.userId, scope.appId],
    );
    return row ? mapConfirmation(row) : null;
  }

  async deleteImportConfirmation(scope: Scope, confirmationId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM agent_memory_import_confirmations WHERE id = ? AND user_id = ? AND target_app_id = ?',
      [confirmationId, scope.userId, scope.appId],
    );
  }

  async deleteExpiredImportConfirmations(now: number): Promise<number> {
    const result = await this.db.execute('DELETE FROM agent_memory_import_confirmations WHERE expires_at <= ?', [now]);
    return result.changes;
  }
}
