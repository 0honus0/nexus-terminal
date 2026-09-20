import type {
  ApprovalRepositoryPort,
  ApprovalView,
} from '../../../modules/agent/runtime/approvals/approval.repository.port';
import type { Scope } from '../../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { parseToolInspection } from '../runtime/durable-state-decoders';

interface ApprovalRow {
  id: string;
  user_id: number;
  app_id: string;
  run_id: string;
  tool_call_id: string;
  requested_by_runtime_id: string;
  operation_hash: string;
  operation_hash_version: number;
  kind: ApprovalView['kind'];
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
  a.operation_hash, a.operation_hash_version, a.kind, a.status, a.policy_revision, a.input_revision,
  a.decided_by_user_id, a.decided_at, a.consumed_at, a.requested_at, a.expires_at, a.version,
  COALESCE(a.inspection_json, t.inspection_json) AS inspection_json`;

const mapRow = (row: ApprovalRow): ApprovalView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  runId: row.run_id,
  toolCallId: row.tool_call_id,
  requestedByRuntimeId: row.requested_by_runtime_id,
  operationHash: row.operation_hash,
  operationHashVersion: 1,
  kind: row.kind,
  status: row.status,
  policyRevision: row.policy_revision,
  inputRevision: row.input_revision,
  decidedByUserId: row.decided_by_user_id,
  decidedAt: row.decided_at,
  consumedAt: row.consumed_at,
  requestedAt: row.requested_at,
  expiresAt: row.expires_at,
  version: row.version,
  inspection: parseToolInspection(row.inspection_json),
});

export class SqliteApprovalRepository implements ApprovalRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

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
}
