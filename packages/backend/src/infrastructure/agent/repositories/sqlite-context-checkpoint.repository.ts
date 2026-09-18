import type {
  ContextCheckpointGenerator,
  ContextCheckpointRepositoryPort,
  ContextCheckpointView,
  ContextCheckpointVisibility,
  UpsertContextCheckpointRecord,
} from '../../../modules/agent/ai/context-checkpoint.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface ContextCheckpointRow {
  id: string;
  thread_id: string;
  visibility_hash: string;
  visibility_json: string;
  from_sequence: number;
  to_sequence: number;
  source_hash: string;
  strategy_version: string;
  generator_json: string;
  source_tokens: number;
  summary_tokens: number;
  content: string;
  created_at: number;
}

const parseVisibility = (value: string): ContextCheckpointVisibility => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('PERSISTED_STATE_INVALID');
  const record = parsed as Record<string, unknown>;
  if (record.kind === 'thread_prefix') return { kind: 'thread_prefix' };
  if (
    record.kind === 'run_boundary' &&
    typeof record.runId === 'string' &&
    record.runId &&
    record.historyBoundary &&
    !Array.isArray(record.historyBoundary) &&
    typeof record.historyBoundary === 'object'
  ) {
    const boundary = record.historyBoundary as Record<string, unknown>;
    const baseThrough = boundary.baseThrough;
    const runThrough = boundary.runThrough;
    if (
      Number.isSafeInteger(baseThrough) &&
      Number(baseThrough) >= 0 &&
      runThrough &&
      !Array.isArray(runThrough) &&
      typeof runThrough === 'object' &&
      Object.entries(runThrough).every(
        ([runId, through]) => Boolean(runId) && Number.isSafeInteger(through) && Number(through) >= 0,
      )
    ) {
      return {
        kind: 'run_boundary',
        runId: record.runId,
        historyBoundary: {
          baseThrough: Number(baseThrough),
          runThrough: Object.fromEntries(Object.entries(runThrough).map(([runId, through]) => [runId, Number(through)])),
        },
      };
    }
  }
  throw new Error('PERSISTED_STATE_INVALID');
};

const parseGenerator = (value: string): ContextCheckpointGenerator => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('PERSISTED_STATE_INVALID');
  const record = parsed as Record<string, unknown>;
  if (record.kind !== 'deterministic' || typeof record.version !== 'string' || !record.version) {
    throw new Error('PERSISTED_STATE_INVALID');
  }
  return { kind: 'deterministic', version: record.version };
};

const mapRow = (row: ContextCheckpointRow): ContextCheckpointView => ({
  id: row.id,
  threadId: row.thread_id,
  visibilityHash: row.visibility_hash,
  visibility: parseVisibility(row.visibility_json),
  fromSequence: row.from_sequence,
  toSequence: row.to_sequence,
  sourceHash: row.source_hash,
  strategyVersion: row.strategy_version,
  generator: parseGenerator(row.generator_json),
  sourceTokens: row.source_tokens,
  summaryTokens: row.summary_tokens,
  content: row.content,
  createdAt: row.created_at,
});

export class SqliteContextCheckpointRepository implements ContextCheckpointRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async getExact(
    scope: UpsertContextCheckpointRecord['scope'],
    threadId: string,
    visibilityHash: string,
    fromSequence: number,
    toSequence: number,
    strategyVersion: string,
  ): Promise<ContextCheckpointView | null> {
    const row = await this.db.queryOne<ContextCheckpointRow>(
      `SELECT c.id, c.thread_id, c.visibility_hash, c.visibility_json, c.from_sequence, c.to_sequence,
              c.source_hash, c.strategy_version, c.generator_json, c.source_tokens, c.summary_tokens,
              c.content, c.created_at
       FROM ai_context_checkpoints c
       INNER JOIN ai_threads t ON t.id = c.thread_id
       WHERE c.thread_id = ? AND c.visibility_hash = ? AND c.from_sequence = ? AND c.to_sequence = ?
         AND c.strategy_version = ? AND t.user_id = ? AND t.app_id = ?`,
      [threadId, visibilityHash, fromSequence, toSequence, strategyVersion, scope.userId, scope.appId],
    );
    return row ? mapRow(row) : null;
  }

  async upsert(record: UpsertContextCheckpointRecord): Promise<ContextCheckpointView> {
    const thread = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?',
      [record.threadId, record.scope.userId, record.scope.appId],
    );
    if (!thread) throw new Error('NOT_FOUND');
    await this.db.execute(
      `INSERT INTO ai_context_checkpoints
        (id, thread_id, visibility_hash, visibility_json, from_sequence, to_sequence, source_hash,
         strategy_version, generator_json, source_tokens, summary_tokens, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, visibility_hash, from_sequence, to_sequence, strategy_version)
       DO UPDATE SET
         source_hash = excluded.source_hash,
         generator_json = excluded.generator_json,
         source_tokens = excluded.source_tokens,
         summary_tokens = excluded.summary_tokens,
         content = excluded.content,
         created_at = excluded.created_at`,
      [
        record.id,
        record.threadId,
        record.visibilityHash,
        JSON.stringify(record.visibility),
        record.fromSequence,
        record.toSequence,
        record.sourceHash,
        record.strategyVersion,
        JSON.stringify(record.generator),
        record.sourceTokens,
        record.summaryTokens,
        record.content,
        record.createdAt,
      ],
    );
    const checkpoint = await this.getExact(
      record.scope,
      record.threadId,
      record.visibilityHash,
      record.fromSequence,
      record.toSequence,
      record.strategyVersion,
    );
    if (!checkpoint) throw new Error('NOT_FOUND');
    return checkpoint;
  }
}
