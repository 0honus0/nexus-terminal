import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
import type { PluginRunnerTarget } from '../../../modules/agent/host/plugin-runner-target.port';
import type {
  CreateEnvironmentCommandRecord,
  CreateEnvironmentGroupRecord,
  CreateEnvironmentRecord,
  EnvironmentRepositoryPort,
} from '../../../modules/agent/environments/environment.repository.port';
import type {
  EnvironmentCommandView,
  EnvironmentGroupDetail,
  EnvironmentGroupView,
  EnvironmentNetworkPolicy,
  EnvironmentPackRef,
  EnvironmentResourceLimits,
  EnvironmentStatus,
  EnvironmentView,
} from '../../../modules/agent/environments/environment.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface GroupRow {
  id: string;
  user_id: number;
  app_id: string;
  run_id: string;
  agent_runtime_id: string;
  status: EnvironmentStatus;
  retained: number;
  limits_json: string;
  version: number;
  created_at: number;
  updated_at: number;
}
interface EnvironmentRow {
  id: string;
  group_id: string;
  kind: EnvironmentView['kind'];
  recipe_id: string;
  recipe_revision: string;
  runtime_digest: string;
  catalog_revision: string;
  pack_refs_json: string;
  runner_plugins_json: string;
  generation: number;
  status: EnvironmentStatus;
  limits_json: string;
  network_json: string;
  retained_manifest_ref: string | null;
  version: number;
  last_active_at: number;
  created_at: number;
  updated_at: number;
}
interface CommandRow {
  id: string;
  user_id: number;
  app_id: string;
  environment_id: string | null;
  group_id: string | null;
  action: string;
  operation_hash: string;
  generation: number;
  status: EnvironmentCommandView['status'];
  result_json: string | null;
  deadline_at: number;
  created_at: number;
  completed_at: number | null;
}

const GROUP_COLUMNS =
  'id,user_id,app_id,run_id,agent_runtime_id,status,retained,limits_json,version,created_at,updated_at';
const ENV_COLUMNS =
  'e.id,e.group_id,e.kind,e.recipe_id,e.recipe_revision,e.runtime_digest,e.catalog_revision,e.pack_refs_json,e.runner_plugins_json,e.generation,e.status,e.limits_json,e.network_json,e.retained_manifest_ref,e.version,e.last_active_at,e.created_at,e.updated_at';
const COMMAND_COLUMNS =
  'id,user_id,app_id,environment_id,group_id,action,operation_hash,generation,status,result_json,deadline_at,created_at,completed_at';

const groupView = (row: GroupRow): EnvironmentGroupView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  runId: row.run_id,
  agentRuntimeId: row.agent_runtime_id,
  status: row.status,
  retained: row.retained === 1,
  limits: JSON.parse(row.limits_json) as JsonValue,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const envView = (row: EnvironmentRow): EnvironmentView => ({
  id: row.id,
  groupId: row.group_id,
  kind: row.kind,
  recipeId: row.recipe_id,
  recipeRevision: row.recipe_revision,
  runtimeDigest: row.runtime_digest,
  catalogRevision: row.catalog_revision,
  packRefs: JSON.parse(row.pack_refs_json) as EnvironmentPackRef[],
  runnerPlugins: JSON.parse(row.runner_plugins_json) as PluginRunnerTarget[],
  generation: row.generation,
  status: row.status,
  limits: JSON.parse(row.limits_json) as EnvironmentResourceLimits,
  network: JSON.parse(row.network_json) as EnvironmentNetworkPolicy,
  retainedManifestRef: row.retained_manifest_ref,
  version: row.version,
  lastActiveAt: row.last_active_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const commandView = (row: CommandRow): EnvironmentCommandView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  environmentId: row.environment_id,
  groupId: row.group_id,
  action: row.action,
  operationHash: row.operation_hash,
  generation: row.generation,
  status: row.status,
  result: row.result_json ? (JSON.parse(row.result_json) as JsonValue) : null,
  deadlineAt: row.deadline_at,
  createdAt: row.created_at,
  completedAt: row.completed_at,
});

const aggregateGroupStatus = (environments: readonly EnvironmentView[]): EnvironmentStatus => {
  if (!environments.length) return 'failed';
  if (environments.every((environment) => environment.status === 'deleted')) return 'deleted';
  if (environments.some((environment) => environment.status === 'failed')) return 'failed';
  if (environments.some((environment) => environment.status === 'deleting')) return 'deleting';
  if (environments.some((environment) => environment.status === 'stopping')) return 'stopping';
  if (environments.some((environment) => environment.status === 'starting')) return 'starting';
  if (environments.some((environment) => environment.status === 'running')) return 'running';
  if (environments.some((environment) => environment.status === 'creating')) return 'creating';
  if (environments.every((environment) => environment.status === 'stopped')) return 'stopped';
  return 'ready';
};

export class SqliteEnvironmentRepository implements EnvironmentRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async createGroup(
    group: CreateEnvironmentGroupRecord,
    environments: CreateEnvironmentRecord[],
  ): Promise<EnvironmentGroupDetail> {
    return this.db.transaction(async (tx) => {
      const existingCommand = await tx.queryOne<{
        request_hash: string;
        status: string;
        result_entity_id: string | null;
      }>(
        `SELECT request_hash,status,result_entity_id FROM agent_commands
         WHERE user_id=? AND app_id=? AND command_name='environment.group.create' AND idempotency_key=?`,
        [group.scope.userId, group.scope.appId, group.idempotencyKey],
      );
      if (existingCommand) {
        if (existingCommand.request_hash !== group.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        if (existingCommand.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
        if (existingCommand.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
        if (!existingCommand.result_entity_id) throw new Error('ENVIRONMENT_STATE_INVALID');
        const replay = await this.getGroupInTx(tx, group.scope, existingCommand.result_entity_id);
        if (!replay) throw new Error('ENVIRONMENT_STATE_INVALID');
        return replay;
      }

      const run = await tx.queryOne<{ id: string }>(
        `SELECT r.id FROM agent_runs r JOIN agent_runtimes rt ON rt.run_id = r.id
         WHERE r.id = ? AND r.user_id = ? AND r.app_id = ? AND rt.id = ? AND r.status IN ('created','running','awaiting_approval','awaiting_budget')`,
        [group.runId, group.scope.userId, group.scope.appId, group.agentRuntimeId],
      );
      if (!run) throw new Error('NOT_FOUND');
      const existingGroup = await tx.queryOne<{ id: string }>(
        `SELECT id FROM agent_environment_groups
         WHERE user_id=? AND app_id=? AND run_id=? AND agent_runtime_id=? AND status NOT IN ('deleted','failed')
         LIMIT 1`,
        [group.scope.userId, group.scope.appId, group.runId, group.agentRuntimeId],
      );
      if (existingGroup) throw new Error('ENVIRONMENT_GROUP_EXISTS');
      await tx.execute(
        `INSERT INTO agent_commands
          (id,user_id,app_id,command_name,idempotency_key,request_hash,status,response_status,response_json,result_entity_id,generation,created_at,completed_at,expires_at)
         VALUES (?,?,?,?,?,?,'pending',NULL,NULL,NULL,1,?,NULL,?)`,
        [
          group.commandId,
          group.scope.userId,
          group.scope.appId,
          'environment.group.create',
          group.idempotencyKey,
          group.requestHash,
          group.createdAt,
          group.createdAt + 7 * 24 * 60 * 60,
        ],
      );
      await tx.execute(
        `INSERT INTO agent_environment_groups
          (id,user_id,app_id,run_id,agent_runtime_id,status,retained,limits_json,version,created_at,updated_at)
         VALUES (?,?,?,?,?,'creating',?,?,1,?,?)`,
        [
          group.id,
          group.scope.userId,
          group.scope.appId,
          group.runId,
          group.agentRuntimeId,
          group.retained ? 1 : 0,
          JSON.stringify(group.limits),
          group.createdAt,
          group.createdAt,
        ],
      );
      for (const env of environments) {
        await tx.execute(
          `INSERT INTO agent_environments
            (id,group_id,kind,recipe_id,recipe_revision,runtime_digest,catalog_revision,pack_refs_json,runner_plugins_json,generation,status,
             limits_json,network_json,provisioning_ref_json,retained_manifest_ref,version,last_active_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'creating',?,?,NULL,NULL,1,?,?,?)`,
          [
            env.id,
            env.groupId,
            env.kind,
            env.recipeId,
            env.recipeRevision,
            env.runtimeDigest,
            env.catalogRevision,
            JSON.stringify(env.packRefs),
            JSON.stringify(env.runnerPlugins),
            env.generation,
            JSON.stringify(env.limits),
            JSON.stringify(env.network),
            env.createdAt,
            env.createdAt,
            env.createdAt,
          ],
        );
      }
      const detail = await this.getGroupInTx(tx, group.scope, group.id);
      if (!detail) throw new Error('ENVIRONMENT_STATE_INVALID');
      await tx.execute(
        `UPDATE agent_commands
         SET status='committed',response_status=202,response_json=?,result_entity_id=?,completed_at=?
         WHERE id=? AND status='pending'`,
        [JSON.stringify({ groupId: group.id }), group.id, group.createdAt, group.commandId],
      );
      return detail;
    });
  }

  async listGroups(scope: Scope, runId?: string): Promise<EnvironmentGroupView[]> {
    const params: unknown[] = [scope.userId, scope.appId];
    const runClause = runId ? ' AND run_id = ?' : '';
    if (runId) params.push(runId);
    const rows = await this.db.queryAll<GroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM agent_environment_groups WHERE user_id = ? AND app_id = ?${runClause}
       ORDER BY updated_at DESC, id DESC`,
      params,
    );
    return rows.map(groupView);
  }

  async getGroup(scope: Scope, groupId: string): Promise<EnvironmentGroupDetail | null> {
    return this.db.transaction((tx) => this.getGroupInTx(tx, scope, groupId));
  }

  async listUserEnvironments(
    userId: number,
  ): Promise<Array<{ appId: string; retained: boolean; environment: EnvironmentView }>> {
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('VALIDATION_FAILED');
    const rows = await this.db.queryAll<EnvironmentRow & { app_id: string; retained: number }>(
      `SELECT ${ENV_COLUMNS},g.app_id,g.retained FROM agent_environments e
       JOIN agent_environment_groups g ON g.id=e.group_id WHERE g.user_id=? ORDER BY e.updated_at DESC,e.id DESC`,
      [userId],
    );
    return rows.map((row) => ({ appId: row.app_id, retained: row.retained === 1, environment: envView(row) }));
  }

  async getEnvironment(scope: Scope, environmentId: string): Promise<EnvironmentView | null> {
    const row = await this.db.queryOne<EnvironmentRow>(
      `SELECT ${ENV_COLUMNS} FROM agent_environments e JOIN agent_environment_groups g ON g.id=e.group_id
       WHERE e.id=? AND g.user_id=? AND g.app_id=?`,
      [environmentId, scope.userId, scope.appId],
    );
    return row ? envView(row) : null;
  }

  async setEnvironmentStatus(
    scope: Scope,
    environmentId: string,
    expectedVersion: number,
    status: EnvironmentStatus,
    now: number,
  ): Promise<EnvironmentView> {
    const changed = await this.db.execute(
      `UPDATE agent_environments SET status=?,version=version+1,last_active_at=?,updated_at=?
       WHERE id=? AND version=? AND group_id IN (SELECT id FROM agent_environment_groups WHERE user_id=? AND app_id=?)`,
      [status, now, now, environmentId, expectedVersion, scope.userId, scope.appId],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
    const result = await this.getEnvironment(scope, environmentId);
    if (!result) throw new Error('NOT_FOUND');
    return result;
  }

  async refreshGroupStatus(scope: Scope, groupId: string, now: number): Promise<EnvironmentGroupDetail> {
    return this.db.transaction(async (tx) => {
      const detail = await this.getGroupInTx(tx, scope, groupId);
      if (!detail) throw new Error('NOT_FOUND');
      const status = aggregateGroupStatus(detail.environments);
      if (status !== detail.status) {
        await tx.execute(
          `UPDATE agent_environment_groups SET status=?,version=version+1,updated_at=?
           WHERE id=? AND user_id=? AND app_id=?`,
          [status, now, groupId, scope.userId, scope.appId],
        );
      }
      const updated = await this.getGroupInTx(tx, scope, groupId);
      if (!updated) throw new Error('NOT_FOUND');
      return updated;
    });
  }

  async createCommand(record: CreateEnvironmentCommandRecord): Promise<EnvironmentCommandView> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<CommandRow>(
        `SELECT ${COMMAND_COLUMNS} FROM agent_environment_commands
         WHERE user_id=? AND app_id=? AND action=? AND operation_hash=?`,
        [record.scope.userId, record.scope.appId, record.action, record.operationHash],
      );
      if (existing) return commandView(existing);
      await tx.execute(
        `INSERT INTO agent_environment_commands
          (id,environment_id,group_id,user_id,app_id,action,operation_hash,generation,status,request_json,result_json,deadline_at,created_at,completed_at)
         VALUES (?,?,?,?,?,?,?,?,'pending',?,NULL,?,?,NULL)`,
        [
          record.id,
          record.environmentId ?? null,
          record.groupId ?? null,
          record.scope.userId,
          record.scope.appId,
          record.action,
          record.operationHash,
          record.generation,
          JSON.stringify(record.request),
          record.deadlineAt,
          record.createdAt,
        ],
      );
      const inserted = await tx.queryOne<CommandRow>(
        `SELECT ${COMMAND_COLUMNS} FROM agent_environment_commands WHERE id=? AND user_id=? AND app_id=?`,
        [record.id, record.scope.userId, record.scope.appId],
      );
      if (!inserted) throw new Error('ENVIRONMENT_COMMAND_STATE_INVALID');
      return commandView(inserted);
    });
  }

  async getCommand(scope: Scope, commandId: string): Promise<EnvironmentCommandView | null> {
    const row = await this.db.queryOne<CommandRow>(
      `SELECT ${COMMAND_COLUMNS} FROM agent_environment_commands WHERE id=? AND user_id=? AND app_id=?`,
      [commandId, scope.userId, scope.appId],
    );
    return row ? commandView(row) : null;
  }

  async completeCommand(
    scope: Scope,
    commandId: string,
    status: EnvironmentCommandView['status'],
    result: JsonValue | null,
    now: number,
  ): Promise<EnvironmentCommandView> {
    if (!['running', 'succeeded', 'failed', 'unknown'].includes(status)) throw new Error('VALIDATION_FAILED');
    const changed = await this.db.execute(
      `UPDATE agent_environment_commands SET status=?,result_json=?,completed_at=CASE WHEN ? IN ('succeeded','failed','unknown') THEN ? ELSE NULL END
       WHERE id=? AND user_id=? AND app_id=? AND status IN ('pending','running')`,
      [status, result === null ? null : JSON.stringify(result), status, now, commandId, scope.userId, scope.appId],
    );
    if (changed.changes !== 1) {
      const existing = await this.getCommand(scope, commandId);
      if (!existing) throw new Error('NOT_FOUND');
      return existing;
    }
    const updated = await this.getCommand(scope, commandId);
    if (!updated) throw new Error('NOT_FOUND');
    return updated;
  }

  async listPendingCommands(limit: number): Promise<EnvironmentCommandView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('VALIDATION_FAILED');
    const rows = await this.db.queryAll<CommandRow>(
      `SELECT ${COMMAND_COLUMNS} FROM agent_environment_commands WHERE status IN ('pending','running') ORDER BY created_at,id LIMIT ?`,
      [limit],
    );
    return rows.map(commandView);
  }

  private async getGroupInTx(
    tx: RelationalDatabase,
    scope: Scope,
    groupId: string,
  ): Promise<EnvironmentGroupDetail | null> {
    const row = await tx.queryOne<GroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM agent_environment_groups WHERE id=? AND user_id=? AND app_id=?`,
      [groupId, scope.userId, scope.appId],
    );
    if (!row) return null;
    const environments = await tx.queryAll<EnvironmentRow>(
      `SELECT ${ENV_COLUMNS} FROM agent_environments e WHERE e.group_id=? ORDER BY e.created_at,e.id`,
      [groupId],
    );
    return { ...groupView(row), environments: environments.map(envView) };
  }
}
