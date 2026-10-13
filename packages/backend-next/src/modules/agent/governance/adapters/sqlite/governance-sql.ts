import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { AGENT_APPROVAL_MAX_LIST_ITEMS } from '@nexus-terminal/shared/agent/governance/values';
import type {
	GovernanceStorage,
	StoredPolicyOverrides,
	StoredPolicy,
	StoredApproval,
	StoredGrant,
	GrantReplaceResult,
	ExecutionReplaceResult,
	ApprovalCommitResult,
	StoredApprovalResolution,
} from '../../storage/governance-storage.js';
import {
	integer,
	string,
	readPolicy,
	readApproval,
	readApprovalSnapshot,
	scopeJson,
	readRunStatus,
} from './governance-row.js';

const approvalColumns =
	'id,user_id,app_id,run_id,tool_call_id,operation_hash,kind,status,policy_revision,input_revision,version,requested_at,expires_at,decided_at,decided_by_user_id,consumed_at,feedback,inspection_json';

async function appExists(tx: SqlExecutor, userId: number, appId: string): Promise<boolean> {
	return (await tx.one('SELECT 1 AS present FROM agent_apps WHERE user_id=? AND id=?', [userId, appId])) !== null;
}

async function currentPolicy(tx: SqlExecutor, userId: number, appId: string): Promise<StoredPolicy | null> {
	if (!(await appExists(tx, userId, appId))) {
		return null;
	}
	const header = await tx.one(
		'SELECT policy_revision,execution_version,execution_overrides_json FROM agent_governance_policies WHERE user_id=? AND app_id=?',
		[userId, appId],
	);
	const grants = await tx.all(
		'SELECT capability,schema_version,scope_json,granted_at FROM agent_governance_grants WHERE user_id=? AND app_id=? ORDER BY capability',
		[userId, appId],
	);
	return readPolicy(userId, appId, header, grants);
}

async function ensurePolicy(tx: SqlExecutor, userId: number, appId: string): Promise<void> {
	await tx.run('INSERT OR IGNORE INTO agent_governance_policies(user_id,app_id) VALUES(?,?)', [userId, appId]);
}

async function approvalRow(tx: SqlExecutor, userId: number, appId: string, id: string): Promise<StoredApproval | null> {
	const row = await tx.one(
		`SELECT ${approvalColumns} FROM agent_governance_approvals WHERE id=? AND user_id=? AND app_id=?`,
		[id, userId, appId],
	);
	return row === null ? null : readApproval(row);
}

async function sweep(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	filter: { approvalId?: string; runId?: string },
	now: () => number,
	transition: (approval: StoredApproval, runStatus: AgentRunStatus, now: number) => 'expired' | 'superseded' | null,
): Promise<number> {
	let changed = 0;
	let cursor = '';
	// Keyset traversal bounds adapter memory even when a Run has many old approvals.
	while (true) {
		const rows = await tx.all(
			`SELECT ${approvalColumns} FROM agent_governance_approvals
  WHERE user_id=? AND app_id=? AND status='requested'
  ${filter.approvalId === undefined ? '' : 'AND id=?'} ${filter.runId === undefined ? '' : 'AND run_id=?'}
  AND id>? ORDER BY id LIMIT 128`,
			[
				userId,
				appId,
				...(filter.approvalId === undefined ? [] : [filter.approvalId]),
				...(filter.runId === undefined ? [] : [filter.runId]),
				cursor,
			],
		);
		if (!rows.length) {
			break;
		}
		for (const row of rows) {
			const approval = readApproval(row);
			cursor = approval.id;
			const run = await tx.one('SELECT status FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				approval.runId,
				userId,
				appId,
			]);
			if (!run) {
				throw new Error('Orphan Agent approval');
			}
			const next = transition(approval, readRunStatus(run.status), now());
			if (next === null) {
				continue;
			}
			const result = await tx.run(
				`UPDATE agent_governance_approvals SET status=?,version=version+1
   WHERE user_id=? AND app_id=? AND id=? AND version=? AND status='requested'`,
				[next, userId, appId, approval.id, approval.version],
			);
			if (result.changes !== 1) {
				throw new Error('Governance approval lifecycle CAS lost');
			}
			changed++;
		}
		if (rows.length < 128) {
			break;
		}
	}
	return changed;
}

export class SqliteGovernanceStorage implements GovernanceStorage {
	constructor(private readonly db: SqliteRuntime) {}

	policy(userId: number, appId: string): Promise<StoredPolicy | null> {
		return this.db.transaction((tx) => currentPolicy(tx, userId, appId));
	}

	async replaceGrants(
		userId: number,
		appId: string,
		expectedRevision: number,
		grants: StoredGrant[],
		decide: (current: StoredPolicy) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<GrantReplaceResult> {
		return this.db.transaction(async (tx) => {
			const current = await currentPolicy(tx, userId, appId);
			if (!current) {
				return { status: 'not_found' };
			}
			if (current.revision !== expectedRevision) {
				return { status: 'version_conflict' };
			}
			const decision = decide(current);
			if (!decision.allow) {
				return { status: 'version_conflict' };
			}
			await ensurePolicy(tx, userId, appId);
			const cas = await tx.run(
				'UPDATE agent_governance_policies SET policy_revision=policy_revision+1 WHERE user_id=? AND app_id=? AND policy_revision=?',
				[userId, appId, expectedRevision],
			);
			if (cas.changes !== 1) {
				return { status: 'version_conflict' };
			}
			await tx.run('DELETE FROM agent_governance_grants WHERE user_id=? AND app_id=?', [userId, appId]);
			for (const grant of grants) {
				await tx.run(
					`INSERT INTO agent_governance_grants
    (user_id,app_id,capability,schema_version,scope_json,granted_at) VALUES(?,?,?,?,?,?)`,
					[userId, appId, grant.capability, grant.schemaVersion, scopeJson(grant.scope), grant.grantedAt],
				);
			}
			if (decision.pendingStatus !== null) {
				await tx.run(
					`UPDATE agent_governance_approvals SET status=?,version=version+1
    WHERE user_id=? AND app_id=? AND status='requested'`,
					[decision.pendingStatus, userId, appId],
				);
			}
			const updated = await currentPolicy(tx, userId, appId);
			if (!updated) {
				throw new Error('Governance policy disappeared');
			}
			return { status: 'ok', policy: updated };
		});
	}

	async replaceExecution(
		userId: number,
		appId: string,
		version: number,
		overrides: StoredPolicyOverrides,
		decide: (current: StoredPolicy) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<ExecutionReplaceResult> {
		return this.db.transaction(async (tx) => {
			const current = await currentPolicy(tx, userId, appId);
			if (!current) {
				return { status: 'not_found' };
			}
			if (current.executionVersion !== version) {
				return { status: 'version_conflict' };
			}
			const decision = decide(current);
			if (!decision.allow) {
				return { status: 'version_conflict' };
			}
			await ensurePolicy(tx, userId, appId);
			const updated = await tx.run(
				`UPDATE agent_governance_policies
    SET execution_version=execution_version+1,execution_overrides_json=?,policy_revision=policy_revision+1
    WHERE user_id=? AND app_id=? AND execution_version=?`,
				[JSON.stringify(overrides), userId, appId, version],
			);
			if (updated.changes !== 1) {
				return { status: 'version_conflict' };
			}
			if (decision.pendingStatus !== null) {
				await tx.run(
					`UPDATE agent_governance_approvals SET status=?,version=version+1
     WHERE user_id=? AND app_id=? AND status='requested'`,
					[decision.pendingStatus, userId, appId],
				);
			}
			const policy = await currentPolicy(tx, userId, appId);
			if (!policy) {
				throw new Error('Governance policy disappeared');
			}
			return { status: 'ok', policy };
		});
	}

	async getApproval(
		userId: number,
		appId: string,
		id: string,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
	): Promise<StoredApproval | null> {
		return this.db.transaction(async (tx) => {
			await sweep(tx, userId, appId, { approvalId: id }, now, transition);
			return approvalRow(tx, userId, appId, id);
		});
	}

	async listApprovals(
		userId: number,
		appId: string,
		runId: string,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
	): Promise<StoredApproval[] | null | 'limit_exceeded'> {
		return this.db.transaction(async (tx) => {
			const run = await tx.one('SELECT id FROM agent_runs WHERE user_id=? AND app_id=? AND id=?', [
				userId,
				appId,
				runId,
			]);
			if (!run) {
				return null;
			}
			// Do not scan or materialize an oversized Run before returning a safe capacity failure.
			const overflow = await tx.one(
				'SELECT id FROM agent_governance_approvals WHERE user_id=? AND app_id=? AND run_id=? ORDER BY requested_at,id LIMIT 1 OFFSET ?',
				[userId, appId, runId, AGENT_APPROVAL_MAX_LIST_ITEMS],
			);
			if (overflow) {
				return 'limit_exceeded';
			}
			await sweep(tx, userId, appId, { runId }, now, transition);
			const rows = await tx.all(
				`SELECT ${approvalColumns} FROM agent_governance_approvals
     WHERE user_id=? AND app_id=? AND run_id=? ORDER BY requested_at,id LIMIT ?`,
				[userId, appId, runId, AGENT_APPROVAL_MAX_LIST_ITEMS + 1],
			);
			if (rows.length > AGENT_APPROVAL_MAX_LIST_ITEMS) {
				return 'limit_exceeded';
			}
			return rows.map(readApproval);
		});
	}

	async requestApproval(
		input: { userId: number; appId: string; runId: string },
		create: (policy: StoredPolicy, runStatus: AgentRunStatus, runVersion: number) => StoredApproval | null,
	): Promise<StoredApproval | null> {
		return this.db.transaction(async (tx) => {
			const policy = await currentPolicy(tx, input.userId, input.appId);
			if (!policy) {
				return null;
			}
			const run = await tx.one('SELECT status,version FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				input.runId,
				input.userId,
				input.appId,
			]);
			if (!run) {
				return null;
			}
			const requested = create(policy, readRunStatus(run.status), integer(run.version, 1));
			if (requested === null) {
				return null;
			}
			await tx.run(
				`INSERT INTO agent_governance_approvals
    (id,user_id,app_id,run_id,tool_call_id,operation_hash,kind,status,policy_revision,
     input_revision,version,requested_at,expires_at,decided_at,decided_by_user_id,consumed_at,feedback,inspection_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
				[
					requested.id,
					requested.userId,
					requested.appId,
					requested.runId,
					requested.toolCallId,
					requested.operationHash,
					requested.kind,
					requested.status,
					requested.policyRevision,
					requested.inputRevision,
					requested.version,
					requested.requestedAt,
					requested.expiresAt,
					requested.decidedAt,
					requested.decidedByUserId,
					requested.consumedAt,
					requested.feedback,
					JSON.stringify(requested.inspection),
				],
			);
			return requested;
		});
	}

	async resolveApproval(
		input: StoredApprovalResolution,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
		decide: (
			approval: StoredApproval,
			policy: StoredPolicy,
			runStatus: AgentRunStatus,
			runVersion: number,
			now: number,
		) => boolean,
	): Promise<ApprovalCommitResult> {
		const {
			userId,
			appId,
			approvalId: id,
			decision,
			expectedVersion: version,
			operationKey: key,
			requestHash,
			feedback,
		} = input;
		return this.db.transaction(async (tx) => {
			const idempotent = await tx.one(
				`SELECT request_hash,approval_id,result_status,result_version,result_json
    FROM agent_governance_resolution_keys WHERE user_id=? AND app_id=? AND operation_key=?`,
				[userId, appId, key],
			);
			if (idempotent) {
				if (string(idempotent.request_hash) !== requestHash || string(idempotent.approval_id) !== id) {
					return { status: 'idempotency_conflict' };
				}
				const result = string(idempotent.result_status);
				if (result !== 'approved' && result !== 'denied') {
					throw new Error('Corrupt approval outcome');
				}
				const snapshot = readApprovalSnapshot(idempotent.result_json);
				if (
					snapshot.status !== result ||
					snapshot.version !== integer(idempotent.result_version, 1) ||
					snapshot.userId !== userId ||
					snapshot.appId !== appId ||
					snapshot.id !== id
				) {
					throw new Error('Corrupt approval idempotency snapshot');
				}
				return {
					status: 'replayed',
					approval: snapshot,
				};
			}
			await sweep(tx, userId, appId, { approvalId: id }, now, transition);
			const approval = await approvalRow(tx, userId, appId, id);
			if (!approval) {
				return { status: 'not_found' };
			}
			if (approval.status !== 'requested') {
				return { status: 'approval_stale' };
			}
			if (approval.version !== version) {
				return { status: 'version_conflict' };
			}
			const policy = await currentPolicy(tx, userId, appId);
			const run = await tx.one('SELECT status,version FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				approval.runId,
				userId,
				appId,
			]);
			const decidedAt = now();
			if (
				!policy ||
				!run ||
				!decide(approval, policy, readRunStatus(run.status), integer(run.version, 1), decidedAt)
			) {
				return { status: 'approval_stale' };
			}
			const updated = await tx.run(
				`UPDATE agent_governance_approvals
    SET status=?,decided_at=?,decided_by_user_id=?,feedback=?,version=version+1
    WHERE id=? AND user_id=? AND app_id=? AND version=? AND status='requested'`,
				[decision, decidedAt, userId, feedback, id, userId, appId, version],
			);
			if (updated.changes !== 1) {
				return { status: 'version_conflict' };
			}
			const committedRow = await tx.one(
				`SELECT ${approvalColumns} FROM agent_governance_approvals
				WHERE id=? AND user_id=? AND app_id=?`,
				[id, userId, appId],
			);
			if (!committedRow) {
				throw new Error('Approval vanished during commit');
			}
			const resolved = readApproval(committedRow);
			await tx.run(
				`INSERT INTO agent_governance_resolution_keys
    (user_id,app_id,operation_key,request_hash,approval_id,result_status,result_version,result_json)
    VALUES(?,?,?,?,?,?,?,?)`,
				[userId, appId, key, requestHash, id, decision, version + 1, JSON.stringify(committedRow)],
			);
			return { status: 'ok', approval: resolved };
		});
	}

	async invalidateRunApprovals(
		userId: number,
		appId: string,
		runId: string,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
	): Promise<number> {
		return this.db.transaction((tx) => sweep(tx, userId, appId, { runId }, now, transition));
	}
}
