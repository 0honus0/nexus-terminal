import type {
  ApprovalRepositoryPort,
  ApprovalView,
  RequestApprovalInput,
  ResolveApprovalInput,
} from '../../../modules/agent/runtime/approvals/approval.repository.port';
import type { ToolInspection } from '../../../modules/agent/capabilities/tool.types';
import type { Scope } from '../../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface ApprovalRow {
  id: string;
  user_id: number;
  app_id: string;
  run_id: string;
  tool_call_id: string;
  requested_by_runtime_id: string;
  operation_hash: string;
  operation_hash_version: number;
  status: ApprovalView['status'];
  policy_revision: number;
  input_revision: number;
  decided_by_user_id: number | null;
  decided_at: number | null;
  consumed_at: number | null;
  requested_at: number;
  expires_at: number;
  version: number;
  inspection_json: string;
}

const columns = `a.id, a.user_id, a.app_id, a.run_id, a.tool_call_id, a.requested_by_runtime_id,
  a.operation_hash, a.operation_hash_version, a.status, a.policy_revision, a.input_revision,
  a.decided_by_user_id, a.decided_at, a.consumed_at, a.requested_at, a.expires_at, a.version,
  t.inspection_json`;

const mapRow = (row: ApprovalRow): ApprovalView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  runId: row.run_id,
  toolCallId: row.tool_call_id,
  requestedByRuntimeId: row.requested_by_runtime_id,
  operationHash: row.operation_hash,
  operationHashVersion: 1,
  status: row.status,
  policyRevision: row.policy_revision,
  inputRevision: row.input_revision,
  decidedByUserId: row.decided_by_user_id,
  decidedAt: row.decided_at,
  consumedAt: row.consumed_at,
  requestedAt: row.requested_at,
  expiresAt: row.expires_at,
  version: row.version,
  inspection: JSON.parse(row.inspection_json) as ToolInspection,
});

export class SqliteApprovalRepository implements ApprovalRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async request(input: RequestApprovalInput): Promise<ApprovalView> {
    await this.db.execute(
      `INSERT INTO agent_approvals
        (id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
         operation_hash_version, status, policy_revision, input_revision, decided_by_user_id,
         decided_at, consumed_at, requested_at, expires_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'requested', ?, ?, NULL, NULL, NULL, ?, ?, 1)`,
      [
        input.id,
        input.scope.userId,
        input.scope.appId,
        input.runId,
        input.toolCallId,
        input.requestedByRuntimeId,
        input.inspection.operationHash,
        input.inspection.policyRevision,
        input.inspection.inputRevision,
        input.requestedAt,
        input.expiresAt,
      ],
    );
    const created = await this.get(input.scope, input.id);
    if (!created) throw new Error('APPROVAL_STATE_INVALID');
    return created;
  }

  async get(scope: Scope, approvalId: string): Promise<ApprovalView | null> {
    const row = await this.db.queryOne<ApprovalRow>(
      `SELECT ${columns} FROM agent_approvals a
       JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
       WHERE a.id = ? AND a.user_id = ? AND a.app_id = ?`,
      [approvalId, scope.userId, scope.appId],
    );
    return row ? mapRow(row) : null;
  }

  async list(scope: Scope, runId: string): Promise<ApprovalView[]> {
    const rows = await this.db.queryAll<ApprovalRow>(
      `SELECT ${columns} FROM agent_approvals a
       JOIN agent_tool_calls t ON t.id = a.tool_call_id AND t.run_id = a.run_id
       WHERE a.run_id = ? AND a.user_id = ? AND a.app_id = ? ORDER BY a.requested_at, a.id`,
      [runId, scope.userId, scope.appId],
    );
    return rows.map(mapRow);
  }

  async resolve(input: ResolveApprovalInput): Promise<ApprovalView> {
    const changed = await this.db.execute(
      `UPDATE agent_approvals SET status = ?, decided_by_user_id = ?, decided_at = ?, version = version + 1
       WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'requested' AND version = ?
         AND operation_hash = ? AND policy_revision = ? AND input_revision = ? AND expires_at > ?`,
      [
        input.decision,
        input.decidedByUserId,
        input.decidedAt,
        input.approvalId,
        input.scope.userId,
        input.scope.appId,
        input.expectedVersion,
        input.operationHash,
        input.expectedPolicyRevision,
        input.expectedInputRevision,
        input.decidedAt,
      ],
    );
    if (changed.changes !== 1) throw new Error('APPROVAL_STALE');
    const result = await this.get(input.scope, input.approvalId);
    if (!result) throw new Error('NOT_FOUND');
    return result;
  }

  async consume(
    scope: Scope,
    approvalId: string,
    operationHash: string,
    expectedVersion: number,
    now: number,
  ): Promise<ApprovalView> {
    const changed = await this.db.execute(
      `UPDATE agent_approvals SET consumed_at = ?, version = version + 1
       WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'approved' AND consumed_at IS NULL
         AND operation_hash = ? AND version = ? AND expires_at > ?`,
      [now, approvalId, scope.userId, scope.appId, operationHash, expectedVersion, now],
    );
    if (changed.changes !== 1) throw new Error('APPROVAL_STALE');
    const result = await this.get(scope, approvalId);
    if (!result) throw new Error('NOT_FOUND');
    return result;
  }

  async expire(now: number): Promise<number> {
    const changed = await this.db.execute(
      `UPDATE agent_approvals SET status = 'expired', decided_at = ?, version = version + 1
       WHERE status = 'requested' AND expires_at <= ?`,
      [now, now],
    );
    return changed.changes;
  }

  async supersedeRun(scope: Scope, runId: string, inputRevision: number, now: number): Promise<number> {
    const changed = await this.db.execute(
      `UPDATE agent_approvals SET status = 'superseded', decided_at = ?, version = version + 1
       WHERE run_id = ? AND user_id = ? AND app_id = ? AND status = 'requested' AND input_revision < ?`,
      [now, runId, scope.userId, scope.appId, inputRevision],
    );
    return changed.changes;
  }
}
