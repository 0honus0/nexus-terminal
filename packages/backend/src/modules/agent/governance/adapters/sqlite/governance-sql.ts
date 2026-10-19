import { executionSettings } from '../../../execution/adapters/sqlite/execution-sql.js';
import type { StoredExecutionSettings } from '../../../execution/storage/execution-storage.js';
import { currentParticipant } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { currentAcpParent } from '../../../runs/adapters/sqlite/acp-parent-sql.js';
import { frozenFromRun } from '../../../runs/adapters/sqlite/run-sql.js';
import { readRunSelection } from '../../../runs/adapters/sqlite/run-selection.js';
import { recordToolEvent } from '../../../runs/adapters/sqlite/run-tool-events.js';
import { toolAuthority } from './tool-authority-sql.js';
import { assertPendingApprovalRevisions } from './policy-write.js';
import type { ProviderStorage } from '../../../providers/storage/provider-storage.js';
import type {
	StoredToolAuthorityIdentity,
	StoredToolAuthorityTask,
	StoredToolAuthorityDecision,
	StoredToolPermitDecision,
	StoredToolAuthority,
} from '../../storage/governance-storage.js';
import { toolOperation } from '../../../runs/adapters/sqlite/run-tool-row.js';
import type { StoredToolOperation } from '../../../runs/storage/run-tool-storage.js';
import { appAuthority } from '../../../scope/adapters/sqlite/app-row.js';
import { currentDenylist, replaceTargetDenylist } from './denylist-sql.js';
import type {
	StoredDenylistCommand,
	StoredTargetDenylist,
	StoredDenylistMutation,
} from '../../storage/governance-storage.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { AGENT_APPROVAL_MAX_LIST_ITEMS, AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
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
	assertRevisionAvailable,
} from './governance-row.js';

const approvalColumns =
	'id,user_id,app_id,run_id,tool_call_id,operation_hash,capability,target_version,kind,status,policy_revision,input_revision,version,requested_at,expires_at,decided_at,decided_by_user_id,consumed_at,feedback,inspection_json';

export async function currentPolicy(tx: SqlReader, userId: number, appId: string): Promise<StoredPolicy | null> {
	const app = await appAuthority(tx, userId, appId);
	if (app === null) {
		return null;
	}
	const header = await tx.one(
		'SELECT policy_revision,execution_version,execution_overrides_json FROM agent_governance_policies WHERE user_id=? AND app_id=?',
		[userId, appId],
	);
	if (header === null) {
		throw new Error('Missing App governance policy');
	}
	const grants = await tx.all(
		'SELECT capability,schema_version,scope_json,granted_at FROM agent_governance_grants WHERE user_id=? AND app_id=? ORDER BY capability LIMIT ?',
		[userId, appId, AGENT_CAPABILITIES.length + 1],
	);
	if (grants.length > AGENT_CAPABILITIES.length) {
		throw new Error('Corrupt Agent grant capacity');
	}
	const denylist = await currentDenylist(tx);
	return readPolicy(userId, appId, header, grants, {
		enabled: app.enabled,
		declared: app.declared,
		capabilities: app.capabilities.map((capability) => capability),
		deniedTargetIds: denylist.entries.map((entry) => entry.connectionId),
	});
}

async function approvalRow(tx: SqlExecutor, userId: number, appId: string, id: string): Promise<StoredApproval | null> {
	const row = await tx.one(
		`SELECT ${approvalColumns} FROM agent_governance_approvals WHERE id=? AND user_id=? AND app_id=?`,
		[id, userId, appId],
	);
	return row === null ? null : readApproval(row);
}

function matchesOperation(approval: StoredApproval, operation: StoredToolOperation): boolean {
	return (
		approval.kind === (operation.toolName === 'acp_inner_permission' ? 'acp_permission' : 'tool') &&
		approval.userId === operation.userId &&
		approval.appId === operation.appId &&
		approval.runId === operation.runId &&
		approval.toolCallId === operation.id &&
		approval.operationHash === operation.operationHash &&
		approval.inputRevision === operation.operationRevision &&
		approval.capability === operation.capability &&
		approval.targetVersion === operation.targetVersion &&
		approval.inspection.targetConnectionId === operation.targetId &&
		approval.inspection.toolName === operation.toolName &&
		approval.inspection.toolVersion === operation.toolVersion &&
		approval.inspection.risk === operation.risk &&
		approval.inspection.mutation === operation.mutation &&
		approval.inspection.summary === operation.summary
	);
}

async function currentToolTarget(tx: SqlExecutor, operation: StoredToolOperation): Promise<boolean> {
	if (
		!(await currentParticipant(
			tx,
			{ userId: operation.userId, appId: operation.appId, runId: operation.runId },
			Date.now,
			operation.toolName,
			operation.modelStepIndex,
		))
	) {
		return false;
	}
	if (!(await currentAcpParent(tx, operation))) {
		return false;
	}
	if (operation.targetId === null) {
		return true;
	}
	const target = await tx.one('SELECT type,version FROM connections WHERE id=?', [operation.targetId]);
	return target !== null && target.type === 'SSH' && integer(target.version, 1) === operation.targetVersion;
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
	const policy = await currentPolicy(tx, userId, appId);
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
			const run = await tx.one(
				'SELECT status,selected_connections_json FROM agent_runs WHERE id=? AND user_id=? AND app_id=?',
				[approval.runId, userId, appId],
			);
			if (!run) {
				throw new Error('Orphan Agent approval');
			}
			const operation = await toolOperation(tx, userId, appId, approval.runId, approval.toolCallId);
			const stale =
				operation === null ||
				operation.state !== 'inspected' ||
				!matchesOperation(approval, operation) ||
				policy === null ||
				policy.revision !== approval.policyRevision ||
				!(await currentToolTarget(tx, operation));
			const next = transition(approval, readRunStatus(run.status), now()) ?? (stale ? 'superseded' : null);
			if (next === null) {
				continue;
			}
			assertRevisionAvailable(approval.version, 1);
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
	constructor(
		private readonly db: SqliteRuntime,
		private readonly providers: ProviderStorage,
	) {}

	toolAuthority(
		input: StoredToolAuthorityIdentity,
		task: StoredToolAuthorityTask,
		clock: () => number,
		decide: StoredToolAuthorityDecision,
		permit: StoredToolPermitDecision,
	): Promise<StoredToolAuthority | null> {
		return this.db.transaction((tx) =>
			toolAuthority(tx, input, task, clock, currentPolicy, this.providers, decide, permit),
		);
	}

	consumeApproval(
		input: { userId: number; appId: string; approvalId: string; expectedVersion: number },
		clock: () => { approvalTime: number; operationTime: number },
		decide: (
			approval: StoredApproval,
			policy: StoredPolicy,
			status: AgentRunStatus,
			operationRevision: number,
			now: number,
		) => boolean,
		authorize: StoredToolAuthorityDecision,
	): Promise<StoredToolOperation | 'approval_stale'> {
		return this.db.transaction(async (tx) => {
			const approval = await approvalRow(tx, input.userId, input.appId, input.approvalId);
			if (
				approval === null ||
				approval.version !== input.expectedVersion ||
				approval.status !== 'approved' ||
				approval.consumedAt !== null
			) {
				return 'approval_stale';
			}
			const operation = await toolOperation(tx, input.userId, input.appId, approval.runId, approval.toolCallId);
			const policy = await currentPolicy(tx, input.userId, input.appId);
			const run = await tx.one(
				'SELECT status,selected_connections_json FROM agent_runs WHERE id=? AND user_id=? AND app_id=?',
				[approval.runId, input.userId, input.appId],
			);
			if (
				operation === null ||
				policy === null ||
				run === null ||
				operation.state !== 'inspected' ||
				!matchesOperation(approval, operation) ||
				!(await currentToolTarget(tx, operation))
			) {
				return 'approval_stale';
			}
			const frozen = await frozenFromRun(tx, input.userId, input.appId, approval.runId);
			if (!frozen) {
				return 'approval_stale';
			}
			const provider = await this.providers.snapshot(tx, input.userId, frozen.providerId);
			if (
				!authorize(
					operation,
					policy,
					readRunStatus(run.status),
					frozen,
					provider,
					readRunSelection(run.selected_connections_json),
				)
			) {
				return 'approval_stale';
			}
			const time = clock();
			const consumedAt = time.approvalTime;
			if (!decide(approval, policy, readRunStatus(run.status), operation.operationRevision, consumedAt)) {
				return 'approval_stale';
			}
			assertRevisionAvailable(approval.version, 1);
			assertRevisionAvailable(operation.revision, 1, 2);
			const permit = await tx.run(
				"UPDATE agent_governance_approvals SET consumed_at=?,version=version+1 WHERE id=? AND version=? AND status='approved' AND consumed_at IS NULL",
				[consumedAt, approval.id, approval.version],
			);
			const dispatch = await tx.run(
				"UPDATE agent_run_tools SET state='dispatched',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state='inspected'",
				[time.operationTime, operation.id, operation.revision],
			);
			if (permit.changes !== 1 || dispatch.changes !== 1) {
				throw new Error('Lost atomic approval consumption');
			}
			const dispatched = await toolOperation(tx, input.userId, input.appId, approval.runId, operation.id);
			if (dispatched === null) {
				throw new Error('Consumed tool operation disappeared');
			}
			await recordToolEvent(tx, dispatched);
			return dispatched;
		});
	}

	denylist(): Promise<StoredTargetDenylist> {
		return this.db.transaction(currentDenylist);
	}

	replaceDenylist(
		input: StoredDenylistCommand,
		now: () => number,
		decide: (current: StoredTargetDenylist) => { revoke: boolean },
	): Promise<StoredDenylistMutation | 'version_conflict' | 'not_found'> {
		return this.db.transaction((tx) => replaceTargetDenylist(tx, input, now, decide));
	}

	execution(
		userId: number,
		appId: string,
	): Promise<{ policy: StoredPolicy; settings: StoredExecutionSettings | null } | null> {
		return this.db.transaction(async (tx) => {
			const policy = await currentPolicy(tx, userId, appId);
			return policy === null ? null : { policy, settings: await executionSettings(tx, userId) };
		});
	}

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
			assertRevisionAvailable(current.revision);
			if (decision.pendingStatus !== null) {
				await assertPendingApprovalRevisions(tx, userId, appId);
			}
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
		decide: (
			current: StoredPolicy,
			settings: StoredExecutionSettings | null,
		) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<ExecutionReplaceResult> {
		return this.db.transaction(async (tx) => {
			const current = await currentPolicy(tx, userId, appId);
			if (!current) {
				return { status: 'not_found' };
			}
			if (current.executionVersion !== version) {
				return { status: 'version_conflict' };
			}
			const settings = await executionSettings(tx, userId);
			const decision = decide(current, settings);
			if (!decision.allow) {
				return { status: 'version_conflict' };
			}
			assertRevisionAvailable(current.revision);
			assertRevisionAvailable(current.executionVersion);
			if (decision.pendingStatus !== null) {
				await assertPendingApprovalRevisions(tx, userId, appId);
			}
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
			return { status: 'ok', policy, settings };
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
		input: { userId: number; appId: string; runId: string; toolCallId: string },
		create: (
			policy: StoredPolicy,
			runStatus: AgentRunStatus,
			operation: StoredToolOperation,
		) => StoredApproval | null,
		authorize: StoredToolAuthorityDecision,
	): Promise<StoredApproval | null> {
		return this.db.transaction(async (tx) => {
			const policy = await currentPolicy(tx, input.userId, input.appId);
			if (!policy) {
				return null;
			}
			const run = await tx.one(
				'SELECT status,selected_connections_json FROM agent_runs WHERE id=? AND user_id=? AND app_id=?',
				[input.runId, input.userId, input.appId],
			);
			if (!run) {
				return null;
			}
			const operation = await toolOperation(tx, input.userId, input.appId, input.runId, input.toolCallId);
			if (operation === null || operation.state !== 'inspected' || !(await currentToolTarget(tx, operation))) {
				return null;
			}
			const frozen = await frozenFromRun(tx, input.userId, input.appId, input.runId);
			if (!frozen) {
				return null;
			}
			const provider = await this.providers.snapshot(tx, input.userId, frozen.providerId);
			if (
				!authorize(
					operation,
					policy,
					readRunStatus(run.status),
					frozen,
					provider,
					readRunSelection(run.selected_connections_json),
				)
			) {
				return null;
			}
			const requested = create(policy, readRunStatus(run.status), operation);
			if (requested === null) {
				return null;
			}
			if (
				!matchesOperation(requested, operation) ||
				requested.policyRevision !== policy.revision ||
				requested.status !== 'requested'
			) {
				throw new Error('Approval producer changed authoritative operation');
			}
			const previous = await approvalRow(tx, input.userId, input.appId, requested.id);
			if (previous !== null) {
				const current =
					matchesOperation(previous, operation) &&
					previous.kind === requested.kind &&
					previous.policyRevision === policy.revision &&
					previous.consumedAt === null &&
					previous.expiresAt > requested.requestedAt;
				return current ? previous : null;
			}
			await tx.run(
				`INSERT INTO agent_governance_approvals
    (${approvalColumns})
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
				[
					requested.id,
					requested.userId,
					requested.appId,
					requested.runId,
					requested.toolCallId,
					requested.operationHash,
					requested.capability,
					requested.targetVersion,
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
			operationRevision: number,
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
			const run = await tx.one('SELECT status FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				approval.runId,
				userId,
				appId,
			]);
			const operation = await toolOperation(tx, userId, appId, approval.runId, approval.toolCallId);
			if (
				operation === null ||
				operation.state !== 'inspected' ||
				!matchesOperation(approval, operation) ||
				!(await currentToolTarget(tx, operation))
			) {
				return { status: 'approval_stale' };
			}
			const decidedAt = now();
			if (
				!policy ||
				!run ||
				!decide(approval, policy, readRunStatus(run.status), operation.operationRevision, decidedAt)
			) {
				return { status: 'approval_stale' };
			}
			assertRevisionAvailable(approval.version, 1);
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
