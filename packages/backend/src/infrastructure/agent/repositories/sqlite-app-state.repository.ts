import type { AppStateRepositoryPort } from '../../../modules/agent/host/app-state.repository.port';
import type { AppRecord, AppStatePatch } from '../../../modules/agent/host/app.types';
import type { Scope } from '../../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface AppRow {
  user_id: number;
  app_id: string;
  active_version: string;
  desired_state: AppRecord['desiredState'];
  observed_state: AppRecord['observedState'];
  health_reason: string | null;
  policy_revision: number;
  running_count: number;
  approval_count: number;
  budget_request_count: number;
  accept_new_runs: number;
  version: number;
  created_at: number;
  updated_at: number;
}

const mapRow = (row: AppRow): AppRecord => ({
  userId: row.user_id,
  appId: row.app_id,
  activeVersion: row.active_version,
  desiredState: row.desired_state,
  observedState: row.observed_state,
  healthReason: row.health_reason,
  policyRevision: row.policy_revision,
  runningCount: row.running_count,
  approvalCount: row.approval_count,
  budgetRequestCount: row.budget_request_count,
  acceptNewRuns: row.accept_new_runs === 1,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const selectColumns = `
  user_id, app_id, active_version, desired_state, observed_state, health_reason,
  policy_revision, running_count, approval_count, budget_request_count, accept_new_runs,
  version, created_at, updated_at
`;

export class SqliteAppStateRepository implements AppStateRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async get(scope: Scope): Promise<AppRecord | null> {
    const row = await this.db.queryOne<AppRow>(
      `SELECT ${selectColumns} FROM agent_apps WHERE user_id = ? AND app_id = ?`,
      [scope.userId, scope.appId],
    );
    return row ? mapRow(row) : null;
  }

  async list(userId: number): Promise<AppRecord[]> {
    const rows = await this.db.queryAll<AppRow>(
      `SELECT ${selectColumns} FROM agent_apps WHERE user_id = ? ORDER BY app_id`,
      [userId],
    );
    return rows.map(mapRow);
  }

  async insertDefault(record: AppRecord): Promise<boolean> {
    const result = await this.db.execute(
      `INSERT OR IGNORE INTO agent_apps (
        user_id, app_id, active_version, desired_state, observed_state, health_reason,
        policy_revision, running_count, approval_count, budget_request_count, accept_new_runs,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.userId,
        record.appId,
        record.activeVersion,
        record.desiredState,
        record.observedState,
        record.healthReason,
        record.policyRevision,
        record.runningCount,
        record.approvalCount,
        record.budgetRequestCount,
        record.acceptNewRuns ? 1 : 0,
        record.version,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return result.changes === 1;
  }

  async compareAndSet(scope: Scope, expectedVersion: number, patch: AppStatePatch): Promise<AppRecord> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.activeVersion !== undefined) add('active_version', patch.activeVersion);
    if (patch.desiredState !== undefined) add('desired_state', patch.desiredState);
    if (patch.observedState !== undefined) add('observed_state', patch.observedState);
    if (patch.healthReason !== undefined) add('health_reason', patch.healthReason);
    if (patch.runningCount !== undefined) add('running_count', patch.runningCount);
    if (patch.approvalCount !== undefined) add('approval_count', patch.approvalCount);
    if (patch.budgetRequestCount !== undefined) add('budget_request_count', patch.budgetRequestCount);
    if (patch.acceptNewRuns !== undefined) add('accept_new_runs', patch.acceptNewRuns ? 1 : 0);

    assignments.push('version = version + 1', 'updated_at = ?');
    values.push(Math.floor(Date.now() / 1000), scope.userId, scope.appId, expectedVersion);
    const result = await this.db.execute(
      `UPDATE agent_apps SET ${assignments.join(', ')}
       WHERE user_id = ? AND app_id = ? AND version = ?`,
      values,
    );
    if (result.changes !== 1) throw new Error('APP_STATE_VERSION_CONFLICT');

    const updated = await this.get(scope);
    if (!updated) throw new Error('AGENT_APP_NOT_FOUND');
    return updated;
  }
}
