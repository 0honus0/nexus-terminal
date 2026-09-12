import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
import type { PluginRunnerTarget } from '../../../modules/agent/host/plugin-runner-target.port';
import type {
  AgentWorkspaceRepositoryPort,
  CreateWorkspaceRecord,
  CreateWorkspaceRuntimeCommandRecord,
  ReconfigureWorkspaceRecord,
} from '../../../modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type {
  AgentWorkspaceView,
  ToolchainPackRef,
  WorkspaceNetworkPolicy,
  WorkspaceProfileView,
  WorkspaceResourceLimits,
  WorkspaceRuntimeCommandView,
  WorkspaceStatus,
} from '../../../modules/agent/workspace-runtime/workspace-runtime.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface WorkspaceRow {
  id: string;
  user_id: number;
  app_id: string;
  run_id: string;
  agent_runtime_id: string;
  retained: number;
  kind: WorkspaceProfileView['kind'];
  recipe_id: string;
  recipe_revision: string;
  runtime_digest: string;
  catalog_revision: string;
  toolchain_json: string;
  runner_plugins_json: string;
  generation: number;
  status: WorkspaceStatus;
  limits_json: string;
  network_json: string;
  acp_profiles_json: string;
  browser_target_json: string | null;
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
  workspace_id: string | null;
  action: string;
  operation_hash: string;
  generation: number;
  status: WorkspaceRuntimeCommandView['status'];
  result_json: string | null;
  deadline_at: number;
  created_at: number;
  completed_at: number | null;
}

const WORKSPACE_COLUMNS =
  'id,user_id,app_id,run_id,agent_runtime_id,retained,kind,recipe_id,recipe_revision,runtime_digest,catalog_revision,toolchain_json,runner_plugins_json,generation,status,limits_json,network_json,acp_profiles_json,browser_target_json,retained_manifest_ref,version,last_active_at,created_at,updated_at';
const COMMAND_COLUMNS =
  'id,user_id,app_id,workspace_id,action,operation_hash,generation,status,result_json,deadline_at,created_at,completed_at';

const workspaceView = (row: WorkspaceRow): AgentWorkspaceView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  runId: row.run_id,
  agentRuntimeId: row.agent_runtime_id,
  retained: row.retained === 1,
  profile: {
    kind: row.kind,
    recipeId: row.recipe_id,
    recipeRevision: row.recipe_revision,
    runtimeDigest: row.runtime_digest,
    catalogRevision: row.catalog_revision,
    toolchain: JSON.parse(row.toolchain_json) as ToolchainPackRef[],
    runnerPlugins: JSON.parse(row.runner_plugins_json) as PluginRunnerTarget[],
    limits: JSON.parse(row.limits_json) as WorkspaceResourceLimits,
    network: JSON.parse(row.network_json) as WorkspaceNetworkPolicy,
    acpProfiles: JSON.parse(row.acp_profiles_json || '[]') as WorkspaceProfileView['acpProfiles'],
    browserTarget: row.browser_target_json
      ? (JSON.parse(row.browser_target_json) as WorkspaceProfileView['browserTarget'])
      : null,
  },
  generation: row.generation,
  status: row.status,
  retainedManifestRef: row.retained_manifest_ref,
  version: row.version,
  lastActiveAt: row.last_active_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const commandView = (row: CommandRow): WorkspaceRuntimeCommandView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  workspaceId: row.workspace_id,
  action: row.action,
  operationHash: row.operation_hash,
  generation: row.generation,
  status: row.status,
  result: row.result_json ? (JSON.parse(row.result_json) as JsonValue) : null,
  deadlineAt: row.deadline_at,
  createdAt: row.created_at,
  completedAt: row.completed_at,
});

export class SqliteWorkspaceRepository implements AgentWorkspaceRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async createWorkspace(record: CreateWorkspaceRecord): Promise<AgentWorkspaceView> {
    return this.db.transaction(async (tx) => {
      const existingCommand = await tx.queryOne<{
        request_hash: string;
        status: string;
        result_entity_id: string | null;
      }>(
        `SELECT request_hash,status,result_entity_id FROM agent_commands
         WHERE user_id=? AND app_id=? AND command_name='workspace.create' AND idempotency_key=?`,
        [record.scope.userId, record.scope.appId, record.idempotencyKey],
      );
      if (existingCommand) {
        if (existingCommand.request_hash !== record.requestHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        if (existingCommand.status === 'pending') throw new Error('IDEMPOTENCY_IN_PROGRESS');
        if (existingCommand.status === 'unknown') throw new Error('RECONCILIATION_REQUIRED');
        if (!existingCommand.result_entity_id) throw new Error('WORKSPACE_STATE_INVALID');
        const replay = await this.getWorkspaceInTx(tx, record.scope, existingCommand.result_entity_id);
        if (!replay) throw new Error('WORKSPACE_STATE_INVALID');
        return replay;
      }

      const run = await tx.queryOne<{ id: string }>(
        `SELECT r.id FROM agent_runs r JOIN agent_runtimes rt ON rt.run_id=r.id
         WHERE r.id=? AND r.user_id=? AND r.app_id=? AND rt.id=?
           AND r.status IN ('created','running','awaiting_approval','awaiting_budget')`,
        [record.runId, record.scope.userId, record.scope.appId, record.agentRuntimeId],
      );
      if (!run) throw new Error('NOT_FOUND');
      const existing = await tx.queryOne<{ id: string }>(
        `SELECT id FROM agent_workspaces
         WHERE user_id=? AND app_id=? AND run_id=? AND agent_runtime_id=? AND status NOT IN ('deleted','failed')
         LIMIT 1`,
        [record.scope.userId, record.scope.appId, record.runId, record.agentRuntimeId],
      );
      if (existing) throw new Error('WORKSPACE_EXISTS');

      await tx.execute(
        `INSERT INTO agent_commands
          (id,user_id,app_id,command_name,idempotency_key,request_hash,status,response_status,response_json,result_entity_id,generation,created_at,completed_at,expires_at)
         VALUES (?,?,?,?,?,?,'pending',NULL,NULL,NULL,1,?,NULL,?)`,
        [
          record.commandId,
          record.scope.userId,
          record.scope.appId,
          'workspace.create',
          record.idempotencyKey,
          record.requestHash,
          record.createdAt,
          record.createdAt + 7 * 24 * 60 * 60,
        ],
      );
      await tx.execute(
        `INSERT INTO agent_workspaces
          (id,user_id,app_id,run_id,agent_runtime_id,retained,kind,recipe_id,recipe_revision,runtime_digest,catalog_revision,
           toolchain_json,runner_plugins_json,generation,status,limits_json,network_json,acp_profiles_json,browser_target_json,retained_manifest_ref,version,last_active_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'creating',?,?,?,?,NULL,1,?,?,?)`,
        [
          record.id,
          record.scope.userId,
          record.scope.appId,
          record.runId,
          record.agentRuntimeId,
          record.retained ? 1 : 0,
          record.profile.kind,
          record.profile.recipeId,
          record.profile.recipeRevision,
          record.profile.runtimeDigest,
          record.profile.catalogRevision,
          JSON.stringify(record.profile.toolchain),
          JSON.stringify(record.profile.runnerPlugins),
          record.generation,
          JSON.stringify(record.profile.limits),
          JSON.stringify(record.profile.network),
          JSON.stringify(record.profile.acpProfiles),
          record.profile.browserTarget ? JSON.stringify(record.profile.browserTarget) : null,
          record.createdAt,
          record.createdAt,
          record.createdAt,
        ],
      );
      const workspace = await this.getWorkspaceInTx(tx, record.scope, record.id);
      if (!workspace) throw new Error('WORKSPACE_STATE_INVALID');
      await tx.execute(
        `UPDATE agent_commands
         SET status='committed',response_status=202,response_json=?,result_entity_id=?,completed_at=?
         WHERE id=? AND status='pending'`,
        [JSON.stringify({ workspaceId: record.id }), record.id, record.createdAt, record.commandId],
      );
      return workspace;
    });
  }

  async listWorkspaces(scope: Scope, runId?: string): Promise<AgentWorkspaceView[]> {
    const params: unknown[] = [scope.userId, scope.appId];
    const runClause = runId ? ' AND run_id=?' : '';
    if (runId) params.push(runId);
    const rows = await this.db.queryAll<WorkspaceRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM agent_workspaces
       WHERE user_id=? AND app_id=?${runClause} ORDER BY updated_at DESC,id DESC`,
      params,
    );
    return rows.map(workspaceView);
  }

  async listUserWorkspaces(userId: number): Promise<AgentWorkspaceView[]> {
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('VALIDATION_FAILED');
    const rows = await this.db.queryAll<WorkspaceRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM agent_workspaces WHERE user_id=? ORDER BY updated_at DESC,id DESC`,
      [userId],
    );
    return rows.map(workspaceView);
  }

  async getWorkspace(scope: Scope, workspaceId: string): Promise<AgentWorkspaceView | null> {
    const row = await this.db.queryOne<WorkspaceRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM agent_workspaces WHERE id=? AND user_id=? AND app_id=?`,
      [workspaceId, scope.userId, scope.appId],
    );
    return row ? workspaceView(row) : null;
  }

  async setWorkspaceStatus(
    scope: Scope,
    workspaceId: string,
    expectedVersion: number,
    status: WorkspaceStatus,
    now: number,
  ): Promise<AgentWorkspaceView> {
    const changed = await this.db.execute(
      `UPDATE agent_workspaces SET status=?,version=version+1,last_active_at=?,updated_at=?
       WHERE id=? AND version=? AND user_id=? AND app_id=?`,
      [status, now, now, workspaceId, expectedVersion, scope.userId, scope.appId],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
    const result = await this.getWorkspace(scope, workspaceId);
    if (!result) throw new Error('NOT_FOUND');
    return result;
  }

  async markRuntimeCleanupDeleted(userId: number, workspaceIds: readonly string[], now: number): Promise<void> {
    if (
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      workspaceIds.length > 4096 ||
      new Set(workspaceIds).size !== workspaceIds.length
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    await this.db.transaction(async (tx) => {
      for (const workspaceId of workspaceIds) {
        await tx.execute(
          `UPDATE agent_workspaces
           SET status='deleted',version=version+1,last_active_at=?,updated_at=?
           WHERE id=? AND user_id=? AND status<>'deleted'`,
          [now, now, workspaceId, userId],
        );
      }
    });
  }

  async reconfigureWorkspace(record: ReconfigureWorkspaceRecord): Promise<AgentWorkspaceView> {
    if (record.generation !== record.expectedGeneration + 1) throw new Error('VALIDATION_FAILED');
    const changed = await this.db.execute(
      `UPDATE agent_workspaces
       SET recipe_revision=?,runtime_digest=?,catalog_revision=?,toolchain_json=?,generation=?,status='creating',
           version=version+1,last_active_at=?,updated_at=?
       WHERE id=? AND user_id=? AND app_id=? AND version=? AND generation=? AND status='stopping'`,
      [
        record.recipeRevision,
        record.runtimeDigest,
        record.catalogRevision,
        JSON.stringify(record.toolchain),
        record.generation,
        record.now,
        record.now,
        record.workspaceId,
        record.scope.userId,
        record.scope.appId,
        record.expectedVersion,
        record.expectedGeneration,
      ],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
    const result = await this.getWorkspace(record.scope, record.workspaceId);
    if (!result) throw new Error('NOT_FOUND');
    return result;
  }

  async createCommand(record: CreateWorkspaceRuntimeCommandRecord): Promise<WorkspaceRuntimeCommandView> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<CommandRow>(
        `SELECT ${COMMAND_COLUMNS} FROM agent_workspace_runtime_commands
         WHERE user_id=? AND app_id=? AND action=? AND operation_hash=?`,
        [record.scope.userId, record.scope.appId, record.action, record.operationHash],
      );
      if (existing) return commandView(existing);
      await tx.execute(
        `INSERT INTO agent_workspace_runtime_commands
          (id,workspace_id,user_id,app_id,action,operation_hash,generation,status,request_json,result_json,deadline_at,created_at,completed_at)
         VALUES (?,?,?,?,?,?,?,'pending',?,NULL,?,?,NULL)`,
        [
          record.id,
          record.workspaceId ?? null,
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
        `SELECT ${COMMAND_COLUMNS} FROM agent_workspace_runtime_commands WHERE id=? AND user_id=? AND app_id=?`,
        [record.id, record.scope.userId, record.scope.appId],
      );
      if (!inserted) throw new Error('WORKSPACE_COMMAND_STATE_INVALID');
      return commandView(inserted);
    });
  }

  async getCommand(scope: Scope, commandId: string): Promise<WorkspaceRuntimeCommandView | null> {
    const row = await this.db.queryOne<CommandRow>(
      `SELECT ${COMMAND_COLUMNS} FROM agent_workspace_runtime_commands WHERE id=? AND user_id=? AND app_id=?`,
      [commandId, scope.userId, scope.appId],
    );
    return row ? commandView(row) : null;
  }

  async completeCommand(
    scope: Scope,
    commandId: string,
    status: WorkspaceRuntimeCommandView['status'],
    result: JsonValue | null,
    now: number,
  ): Promise<WorkspaceRuntimeCommandView> {
    if (!['running', 'succeeded', 'failed', 'unknown'].includes(status)) throw new Error('VALIDATION_FAILED');
    const changed = await this.db.execute(
      `UPDATE agent_workspace_runtime_commands
       SET status=?,result_json=?,completed_at=CASE WHEN ? IN ('succeeded','failed','unknown') THEN ? ELSE NULL END
       WHERE id=? AND user_id=? AND app_id=? AND status IN ('pending','running','unknown')`,
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

  async listPendingCommands(limit: number): Promise<WorkspaceRuntimeCommandView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('VALIDATION_FAILED');
    const rows = await this.db.queryAll<CommandRow>(
      `SELECT ${COMMAND_COLUMNS} FROM agent_workspace_runtime_commands
       WHERE status IN ('pending','running','unknown') ORDER BY created_at,id LIMIT ?`,
      [limit],
    );
    return rows.map(commandView);
  }

  private async getWorkspaceInTx(
    tx: RelationalDatabase,
    scope: Scope,
    workspaceId: string,
  ): Promise<AgentWorkspaceView | null> {
    const row = await tx.queryOne<WorkspaceRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM agent_workspaces WHERE id=? AND user_id=? AND app_id=?`,
      [workspaceId, scope.userId, scope.appId],
    );
    return row ? workspaceView(row) : null;
  }
}
