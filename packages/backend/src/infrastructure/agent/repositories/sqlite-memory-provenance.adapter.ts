import type { Scope } from '../../../modules/agent/agent.types';
import type { MemoryProvenancePort } from '../../../modules/agent/ai/memory-provenance.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

export class SqliteMemoryProvenanceAdapter implements MemoryProvenancePort {
  constructor(private readonly db: RelationalDatabase) {}

  async assertRuntime(scope: Scope, runId: string, runtimeId: string): Promise<void> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT rt.id
       FROM agent_runtimes rt JOIN agent_runs r ON r.id = rt.run_id
       WHERE rt.id = ? AND rt.run_id = ? AND r.user_id = ? AND r.app_id = ?`,
      [runtimeId, runId, scope.userId, scope.appId],
    );
    if (!row) throw new Error('AGENT_RUNTIME_NOT_FOUND');
  }
}
