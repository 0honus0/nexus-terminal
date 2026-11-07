import {
	AGENT_APPROVAL_RISKS,
	AGENT_APPROVAL_STATUSES,
	AGENT_CAPABILITIES,
} from '@nexus-terminal/shared/agent/governance/values';
import { isAgentRecord } from '@nexus-terminal/shared/agent/http-codec';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	OperationApprovalStorage,
	StoredOperationApproval,
	StoredOperationApprovalDecision,
} from '../../storage/operation-approval-storage.js';
import { OperationApprovalRefusal } from '../../storage/operation-approval-storage.js';

function integer(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Invalid operation approval integer');
	}
	return value;
}

function text(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Invalid operation approval text');
	}
	return value;
}

const selectApproval = `SELECT a.*,o.run_id,o.app_id,o.parent_id,o.label FROM agent_operation_approvals a
 JOIN agent_operations o ON o.id=a.operation_id`;

export function readStoredOperationApproval(row: Record<string, unknown>): StoredOperationApproval {
	const capability = AGENT_CAPABILITIES.find((value) => value === row.capability);
	const risk = AGENT_APPROVAL_RISKS.find((value) => value === row.risk);
	const status = AGENT_APPROVAL_STATUSES.find((value) => value === row.status);
	if (!capability || !risk || !status) {
		throw new Error('Invalid operation approval classification');
	}
	return {
		id: text(row.id),
		appId: text(row.app_id),
		runId: text(row.run_id),
		sequence: integer(row.sequence, 1),
		operationId: text(row.operation_id),
		parentOperationId: row.parent_id === null ? null : text(row.parent_id),
		operationName: text(row.label),
		operationHash: text(row.operation_hash),
		policyRevision: integer(row.policy_revision, 1),
		status,
		version: integer(row.version, 1),
		capability,
		risk,
		summary: text(row.summary),
		targetId: row.target_id === null ? null : integer(row.target_id, 1),
		requestedAt: integer(row.requested_at),
		expiresAt: integer(row.expires_at),
		decidedAt: row.decided_at === null ? null : integer(row.decided_at),
		decidedBy: row.decided_by === null ? null : integer(row.decided_by, 1),
		consumedAt: row.consumed_at === null ? null : integer(row.consumed_at),
	};
}

// Native binding facts were frozen before approval. Reject obsolete target revisions
// when reading or deciding, as well as at the final dispatch boundary.
const currentTarget = `AND (json_extract(o.binding_json,'$.kind')<>'native'
 OR json_type(o.binding_json,'$.target')='null' OR EXISTS(
 SELECT 1 FROM connections c WHERE c.id=json_extract(o.binding_json,'$.target.id')
 AND c.version=json_extract(o.binding_json,'$.target.version') AND c.type='SSH'
 AND NOT EXISTS(SELECT 1 FROM agent_target_denylist d WHERE d.connection_id=c.id)))`;

async function expire(tx: SqlExecutor, operationId: string, now: number): Promise<void> {
	await tx.run(
		`UPDATE agent_operation_approvals SET status='expired',version=version+1 WHERE operation_id=?
	 AND status IN ('requested','approved') AND consumed_at IS NULL AND expires_at<=? AND version<?`,
		[operationId, now, Number.MAX_SAFE_INTEGER],
	);
	await tx.run(
		`UPDATE agent_operation_approvals SET status='superseded',version=version+1
	 WHERE operation_id=? AND status IN ('requested','approved') AND consumed_at IS NULL AND version<? AND NOT EXISTS(
	 SELECT 1 FROM agent_operations o JOIN agent_runs r ON r.id=o.run_id
	 JOIN agent_run_executions e ON e.run_id=r.id AND e.generation=o.execution_generation AND e.state='open'
	 JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id AND a.enabled=1
	 JOIN agent_governance_policies p ON p.user_id=r.user_id AND p.app_id=r.app_id
	 AND p.policy_revision=agent_operation_approvals.policy_revision
	 WHERE o.id=agent_operation_approvals.operation_id AND o.state='accepted' AND r.status='running' AND r.deadline_at>? ${currentTarget})`,
		[operationId, Number.MAX_SAFE_INTEGER, now],
	);
}

export class SqliteOperationApprovalStorage implements OperationApprovalStorage {
	private identityReader: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installIdentityReader(reader: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.identityReader) {
			throw new Error('Operation approval identity reader already installed');
		}
		this.identityReader = reader;
	}

	request(input: Parameters<OperationApprovalStorage['request']>[0]): Promise<StoredOperationApproval> {
		return this.db.transaction(async (tx) => {
			const current = await tx.one(
				`SELECT o.id,r.deadline_at,r.approval_mode FROM agent_operations o
			 JOIN agent_runs r ON r.id=o.run_id JOIN agent_run_executions e ON e.run_id=r.id AND e.generation=o.execution_generation
			 JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id AND a.enabled=1
			 JOIN agent_governance_policies p ON p.user_id=r.user_id AND p.app_id=r.app_id AND p.policy_revision=?
			 WHERE o.user_id=? AND o.app_id=? AND o.run_id=? AND o.id=? AND o.execution_generation=?
			 AND o.request_hash=? AND o.revision=? AND o.state='accepted' AND r.status='running' AND e.state='open' AND r.deadline_at>? ${currentTarget}`,
				[
					input.policyRevision,
					input.userId,
					input.appId,
					input.runId,
					input.operationId,
					input.executionGeneration,
					input.operationHash,
					input.operationRevision,
					input.now,
				],
			);
			if (!current) {
				throw new OperationApprovalRefusal('version_conflict');
			}
			await expire(tx, input.operationId, input.now);
			const original = await tx.one(selectApproval + ' WHERE a.operation_id=?', [input.operationId]);
			if (original) {
				const value = readStoredOperationApproval(original);
				if (
					value.policyRevision !== input.policyRevision ||
					value.operationHash !== input.operationHash ||
					value.capability !== input.capability ||
					value.risk !== input.risk ||
					value.targetId !== input.targetId ||
					value.summary !== input.summary
				) {
					throw new OperationApprovalRefusal('version_conflict');
				}
				return value;
			}
			if (current.approval_mode !== 'ask' && current.approval_mode !== 'full_access') {
				throw new Error('Invalid approval mode');
			}
			const automatic = current.approval_mode === 'full_access';
			await tx.run(
				`INSERT INTO agent_operation_approvals(id,operation_id,operation_hash,policy_revision,status,version,expires_at,
			 consumed_at,capability,risk,summary,target_id,requested_at,decided_at,decided_by,sequence)
			 SELECT ?,?,?,?,?,1,?,NULL,?,?,?,?,?,?,NULL,COALESCE(MAX(sequence),0)+1 FROM agent_operation_approvals`,
				[
					input.id,
					input.operationId,
					input.operationHash,
					input.policyRevision,
					automatic ? 'approved' : 'requested',
					Math.min(integer(current.deadline_at), input.now + input.ttlMs),
					input.capability,
					input.risk,
					input.summary,
					input.targetId,
					input.now,
					automatic ? input.now : null,
				],
			);
			const row = await tx.one(selectApproval + ' WHERE a.id=?', [input.id]);
			if (!row) {
				throw new Error('Created operation approval missing');
			}
			return readStoredOperationApproval(row);
		});
	}

	get(userId: number, appId: string, operationId: string, now: number): Promise<StoredOperationApproval | null> {
		return this.read(userId, appId, 'operation_id', operationId, now);
	}

	getApproval(
		userId: number,
		appId: string,
		approvalId: string,
		now: number,
	): Promise<StoredOperationApproval | null> {
		return this.read(userId, appId, 'id', approvalId, now);
	}

	private read(
		userId: number,
		appId: string,
		column: 'id' | 'operation_id',
		id: string,
		now: number,
	): Promise<StoredOperationApproval | null> {
		return this.db.transaction(async (tx) => {
			const owned = await tx.one(selectApproval + ` WHERE o.user_id=? AND o.app_id=? AND a.${column}=?`, [
				userId,
				appId,
				id,
			]);
			if (!owned) {
				return null;
			}
			await expire(tx, text(owned.operation_id), now);
			const row = await tx.one(selectApproval + ' WHERE a.id=?', [text(owned.id)]);
			if (!row) {
				throw new Error('Owned operation approval missing');
			}
			return readStoredOperationApproval(row);
		});
	}

	list(
		userId: number,
		appId: string,
		runId: string,
		after: string | null,
		limit: number,
		now: number,
	): Promise<StoredOperationApproval[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				selectApproval +
					` WHERE o.user_id=? AND o.app_id=? AND o.run_id=? AND a.sequence>?
			 ORDER BY a.sequence LIMIT ?`,
				[userId, appId, runId, after === null ? 0 : Number(after), limit],
			);
			const items: StoredOperationApproval[] = [];
			for (const row of rows) {
				await expire(tx, text(row.operation_id), now);
				const updated = await tx.one(selectApproval + ' WHERE a.id=?', [text(row.id)]);
				if (!updated) {
					throw new Error('Listed operation approval missing');
				}
				items.push(readStoredOperationApproval(updated));
			}
			return items;
		});
	}

	resolve(
		userId: number,
		digest: string,
		command: StoredOperationApprovalDecision,
		now: number,
	): Promise<StoredOperationApproval> {
		return this.db.transaction(async (tx) => {
			if (!this.identityReader || (await this.identityReader(tx, digest)) !== userId) {
				throw new OperationApprovalRefusal('unauthenticated');
			}
			// A reply lost after commit is recovered before checking today's status or policy.
			const replay = await tx.one(
				`SELECT request_hash,result_json FROM agent_operation_approval_commands
			 WHERE user_id=? AND app_id=? AND operation_key=?`,
				[userId, command.appId, command.operationKey],
			);
			if (replay) {
				if (replay.request_hash !== command.requestHash) {
					throw new OperationApprovalRefusal('idempotency_conflict');
				}
				const raw: unknown = JSON.parse(text(replay.result_json));
				if (!isAgentRecord(raw)) {
					throw new Error('Invalid approval command receipt');
				}
				return readStoredOperationApproval(raw);
			}
			const row = await tx.one(selectApproval + ' WHERE o.user_id=? AND o.app_id=? AND a.id=?', [
				userId,
				command.appId,
				command.approvalId,
			]);
			if (!row) {
				throw new OperationApprovalRefusal('not_found');
			}
			const current = readStoredOperationApproval(row);
			if (current.operationHash !== command.operationHash) {
				throw new OperationApprovalRefusal('version_conflict');
			}
			const changed = await tx.run(
				`UPDATE agent_operation_approvals SET status=?,version=version+1,decided_at=?,decided_by=?
			 WHERE id=? AND version=? AND version<? AND status='requested' AND expires_at>? AND EXISTS(
			 SELECT 1 FROM agent_operations o JOIN agent_runs r ON r.id=o.run_id
			 JOIN agent_run_executions e ON e.run_id=r.id AND e.generation=o.execution_generation AND e.state='open'
			 JOIN agent_apps app ON app.id=r.app_id AND app.user_id=r.user_id AND app.enabled=1
			 JOIN agent_governance_policies p ON p.user_id=o.user_id AND p.app_id=o.app_id AND p.policy_revision=agent_operation_approvals.policy_revision
			 WHERE o.id=agent_operation_approvals.operation_id AND o.request_hash=? AND o.state='accepted' AND r.status='running' AND r.deadline_at>? ${currentTarget})`,
				[
					command.decision,
					now,
					userId,
					command.approvalId,
					command.expectedVersion,
					Number.MAX_SAFE_INTEGER,
					now,
					command.operationHash,
					now,
				],
			);
			if (changed.changes !== 1) {
				throw new OperationApprovalRefusal('version_conflict');
			}
			const result = await tx.one(selectApproval + ' WHERE a.id=?', [current.id]);
			if (!result) {
				throw new Error('Resolved operation approval missing');
			}
			await tx.run(
				`INSERT INTO agent_operation_approval_commands(user_id,app_id,operation_key,request_hash,approval_id,result_json,feedback,created_at)
			 VALUES(?,?,?,?,?,?,?,?)`,
				[
					userId,
					command.appId,
					command.operationKey,
					command.requestHash,
					command.approvalId,
					JSON.stringify(result),
					command.feedback,
					now,
				],
			);
			return readStoredOperationApproval(result);
		});
	}
}
