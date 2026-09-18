import type {
  RecallCandidate,
  RecallRepositoryPort,
  Scope,
} from '../../../modules/agent/ai/recall.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { sqliteSearchMatchQuery } from '../../database/sqlite-search-index';
import { parseDurableJsonValue } from '../runtime/durable-state-decoders';

interface MemoryRow {
  id: string;
  content: string;
  source_refs_json: string;
  confidence: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export class SqliteRecallRepository implements RecallRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async searchPublishedCandidates(
    scope: Scope,
    now: number,
    queryTerms: readonly string[],
    candidateLimit: number,
  ): Promise<RecallCandidate[]> {
    const matchQuery = sqliteSearchMatchQuery(queryTerms);
    if (!matchQuery) return [];
    const rows = await this.db.queryAll<MemoryRow>(
      `SELECT m.id, m.content, m.source_refs_json, m.confidence, m.expires_at, m.created_at, m.updated_at
       FROM ai_memories_search
       JOIN ai_memories m ON m.rowid = ai_memories_search.rowid
       WHERE ai_memories_search MATCH ?
         AND m.user_id = ? AND m.app_id = ? AND m.status = 'published'
         AND (m.expires_at IS NULL OR m.expires_at > ?)
       ORDER BY bm25(ai_memories_search), m.updated_at DESC, m.id DESC
       LIMIT ?`,
      [matchQuery, scope.userId, scope.appId, now, candidateLimit],
    );
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      sourceRefs: parseDurableJsonValue(row.source_refs_json),
      confidence: row.confidence,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
