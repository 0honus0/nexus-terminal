import type {
  JsonValue,
  RecallCandidate,
  RecallRepositoryPort,
  Scope,
} from '../../../modules/agent/ai/recall.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

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

  async publishedCandidates(scope: Scope, now: number, scanLimit: number): Promise<RecallCandidate[]> {
    const rows = await this.db.queryAll<MemoryRow>(
      `SELECT id, content, source_refs_json, confidence, expires_at, created_at, updated_at
       FROM ai_memories
       WHERE user_id = ? AND app_id = ? AND status = 'published'
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [scope.userId, scope.appId, now, scanLimit],
    );
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      sourceRefs: JSON.parse(row.source_refs_json) as JsonValue,
      confidence: row.confidence,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
