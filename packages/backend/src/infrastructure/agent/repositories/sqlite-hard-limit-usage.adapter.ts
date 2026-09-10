import type { HardLimitUsagePort, HardLimitUsageSnapshot } from '../../../modules/agent/host/hard-limit-usage.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

export class SqliteHardLimitUsageAdapter implements HardLimitUsagePort {
  constructor(private readonly db: RelationalDatabase) {}

  async read(userId: number): Promise<HardLimitUsageSnapshot> {
    const artifact = await this.db.queryOne<{ used_bytes: number; reserved_bytes: number }>(
      `SELECT used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?`,
      [`artifact:user:${userId}`],
    );
    const runtimes = await this.db.queryOne<{ count: number }>(
      `SELECT COALESCE(SUM(executing_runtime_count), 0) AS count
       FROM agent_runs
       WHERE user_id = ? AND status IN ('running','awaiting_approval','awaiting_budget','cancelling')`,
      [userId],
    );
    return {
      artifactUsedBytes: artifact?.used_bytes ?? 0,
      artifactReservedBytes: artifact?.reserved_bytes ?? 0,
      executingRuntimes: runtimes?.count ?? 0,
      activeEnvironments: 0,
    };
  }
}
