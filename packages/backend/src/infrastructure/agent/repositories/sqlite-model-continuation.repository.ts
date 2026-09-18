import type {
  ModelContinuationRef,
  ModelContinuationRepositoryPort,
  ModelStepContinuationView,
} from '../../../modules/agent/ai/model-continuation.repository.port';
import { decodeModelProviderContinuation } from '../../../modules/agent/ai/model-continuation';
import type { Scope } from '../../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { parseDurableJson } from '../runtime/durable-state-decoders';

interface ContinuationRow {
  run_id: string;
  model_step_id: string;
  continuation_json: string;
}

export class SqliteModelContinuationRepository implements ModelContinuationRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async load(scope: Scope, refs: readonly ModelContinuationRef[]): Promise<ModelStepContinuationView[]> {
    if (refs.length === 0) return [];
    if (refs.length > 256) throw new Error('VALIDATION_FAILED');

    const unique = new Map<string, ModelContinuationRef>();
    for (const ref of refs) {
      if (!ref.runId || !ref.modelStepId) throw new Error('VALIDATION_FAILED');
      unique.set(`${ref.runId}\u0000${ref.modelStepId}`, ref);
    }

    const clauses: string[] = [];
    const params: unknown[] = [scope.userId, scope.appId];
    for (const ref of unique.values()) {
      clauses.push('(s.run_id = ? AND s.id = ?)');
      params.push(ref.runId, ref.modelStepId);
    }

    const rows = await this.db.queryAll<ContinuationRow>(
      `SELECT s.run_id, s.id AS model_step_id, a.continuation_json
       FROM agent_steps s
       JOIN agent_runs r ON r.id = s.run_id AND r.user_id = ? AND r.app_id = ?
       JOIN agent_model_attempts a ON a.step_id = s.id
       WHERE s.kind = 'model'
         AND a.status = 'completed'
         AND a.continuation_json IS NOT NULL
         AND (${clauses.join(' OR ')})
       ORDER BY s.run_id, s.id, a.attempt_index DESC`,
      params,
    );

    const seen = new Set<string>();
    const result: ModelStepContinuationView[] = [];
    for (const row of rows) {
      const key = `${row.run_id}\u0000${row.model_step_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        runId: row.run_id,
        modelStepId: row.model_step_id,
        continuation: decodeModelProviderContinuation(parseDurableJson(row.continuation_json)),
      });
    }
    return result;
  }
}
