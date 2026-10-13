import type {
	GovernanceStorage,
	StoredPolicy,
	StoredGrant,
	StoredApproval,
	StoredScope,
	StoredPolicyOverrides,
} from '../storage/governance-storage.js';
import type {
	Grant,
	GrantScope,
	GrantState,
	PolicyOverrides,
	ExecutionPolicyFacts,
	ApprovalTransition,
	GrantChangeDecision,
	ExecutionChangeDecision,
	ApprovalRequestDecision,
	ApprovalResolveDecision,
	Approval,
	ResolveApproval,
	GrantInput,
	ApprovalRequest,
} from './governance-types.js';
import { AgentFailure } from '../../agent-failure.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';

function toScope(scope: StoredScope): GrantScope {
	if (scope.kind === 'global') {
		return { kind: 'global' };
	}
	if (scope.sshMode === undefined) {
		return { kind: 'targets', targets: {} };
	}
	if (scope.sshMode === 'all') {
		return { kind: 'targets', targets: { ssh: { mode: 'all' } } };
	}
	return { kind: 'targets', targets: { ssh: { mode: 'ids', ids: scope.sshIds.map((id) => id) } } };
}

function fromScope(scope: GrantScope): StoredScope {
	if (scope.kind === 'global') {
		return { kind: 'global' };
	}
	const ssh = scope.targets.ssh;
	if (ssh === undefined) {
		return { kind: 'targets' };
	}
	if (ssh.mode === 'all') {
		return { kind: 'targets', sshMode: 'all' };
	}
	return { kind: 'targets', sshMode: 'ids', sshIds: ssh.ids.map((id) => id) };
}

const toGrant = (grant: StoredGrant): Grant => ({
	capability: grant.capability,
	schemaVersion: 2,
	scope: toScope(grant.scope),
	grantedAt: grant.grantedAt,
});

function toPolicyOverrides(row: StoredPolicyOverrides): PolicyOverrides {
	const result: PolicyOverrides = {};
	if (row.maxModelRequests !== undefined) {
		result.maxModelRequests = row.maxModelRequests;
	}
	if (row.maxAutoModelRequests !== undefined) {
		result.maxAutoModelRequests = row.maxAutoModelRequests;
	}
	if (row.maxAutoActiveExecutionSeconds !== undefined) {
		result.maxAutoActiveExecutionSeconds = row.maxAutoActiveExecutionSeconds;
	}
	if (row.maxActiveExecutionSeconds !== undefined) {
		result.maxActiveExecutionSeconds = row.maxActiveExecutionSeconds;
	}
	if (row.toolTimeoutSeconds !== undefined) {
		result.toolTimeoutSeconds = row.toolTimeoutSeconds;
	}
	if (row.maxToolOutputBytes !== undefined) {
		result.maxToolOutputBytes = row.maxToolOutputBytes;
	}
	if (row.maxRecallItems !== undefined) {
		result.maxRecallItems = row.maxRecallItems;
	}
	if (row.maxRecallBytes !== undefined) {
		result.maxRecallBytes = row.maxRecallBytes;
	}
	if (row.maxSubagentMessages !== undefined) {
		result.maxSubagentMessages = row.maxSubagentMessages;
	}
	if (row.maxSubagentMessageBytes !== undefined) {
		result.maxSubagentMessageBytes = row.maxSubagentMessageBytes;
	}
	if (row.contextCompactionMode !== undefined) {
		result.contextCompactionMode = row.contextCompactionMode;
	}
	if (row.contextProfile !== undefined) {
		result.contextProfile = row.contextProfile;
	}
	return result;
}

function fromOverrides(row: PolicyOverrides): StoredPolicyOverrides {
	const result: StoredPolicyOverrides = {};
	if (row.maxModelRequests !== undefined) {
		result.maxModelRequests = row.maxModelRequests;
	}
	if (row.maxAutoModelRequests !== undefined) {
		result.maxAutoModelRequests = row.maxAutoModelRequests;
	}
	if (row.maxAutoActiveExecutionSeconds !== undefined) {
		result.maxAutoActiveExecutionSeconds = row.maxAutoActiveExecutionSeconds;
	}
	if (row.maxActiveExecutionSeconds !== undefined) {
		result.maxActiveExecutionSeconds = row.maxActiveExecutionSeconds;
	}
	if (row.toolTimeoutSeconds !== undefined) {
		result.toolTimeoutSeconds = row.toolTimeoutSeconds;
	}
	if (row.maxToolOutputBytes !== undefined) {
		result.maxToolOutputBytes = row.maxToolOutputBytes;
	}
	if (row.maxRecallItems !== undefined) {
		result.maxRecallItems = row.maxRecallItems;
	}
	if (row.maxRecallBytes !== undefined) {
		result.maxRecallBytes = row.maxRecallBytes;
	}
	if (row.maxSubagentMessages !== undefined) {
		result.maxSubagentMessages = row.maxSubagentMessages;
	}
	if (row.maxSubagentMessageBytes !== undefined) {
		result.maxSubagentMessageBytes = row.maxSubagentMessageBytes;
	}
	if (row.contextCompactionMode !== undefined) {
		result.contextCompactionMode = row.contextCompactionMode;
	}
	if (row.contextProfile !== undefined) {
		result.contextProfile = row.contextProfile;
	}
	return result;
}

const fromApproval = (approval: StoredApproval): Approval => ({
	id: approval.id,
	userId: approval.userId,
	appId: approval.appId,
	runId: approval.runId,
	toolCallId: approval.toolCallId,
	operationHash: approval.operationHash,
	kind: approval.kind,
	status: approval.status,
	policyRevision: approval.policyRevision,
	inputRevision: approval.inputRevision,
	version: approval.version,
	requestedAt: approval.requestedAt,
	expiresAt: approval.expiresAt,
	decidedAt: approval.decidedAt,
	decidedByUserId: approval.decidedByUserId,
	consumedAt: approval.consumedAt,
	feedback: approval.feedback,
	inspection: {
		toolName: approval.inspection.toolName,
		toolVersion: approval.inspection.toolVersion,
		risk: approval.inspection.risk,
		mutation: approval.inspection.mutation,
		targetConnectionId: approval.inspection.targetConnectionId,
		summary: approval.inspection.summary,
	},
});

const toStoredApproval = (a: Approval): StoredApproval => ({
	id: a.id,
	userId: a.userId,
	appId: a.appId,
	runId: a.runId,
	toolCallId: a.toolCallId,
	operationHash: a.operationHash,
	kind: a.kind,
	status: a.status,
	policyRevision: a.policyRevision,
	inputRevision: a.inputRevision,
	version: a.version,
	requestedAt: a.requestedAt,
	expiresAt: a.expiresAt,
	decidedAt: a.decidedAt,
	decidedByUserId: a.decidedByUserId,
	consumedAt: a.consumedAt,
	feedback: a.feedback,
	inspection: {
		toolName: a.inspection.toolName,
		toolVersion: a.inspection.toolVersion,
		risk: a.inspection.risk,
		mutation: a.inspection.mutation,
		targetConnectionId: a.inspection.targetConnectionId,
		summary: a.inspection.summary,
	},
});

const appState = (stored: StoredPolicy): GrantState => ({
	appId: stored.appId,
	userId: stored.userId,
	revision: stored.revision,
	grants: stored.grants.map(toGrant),
});

const policyFacts = (stored: StoredPolicy): ExecutionPolicyFacts => ({
	version: stored.executionVersion,
	overrides: toPolicyOverrides(stored.overrides),
});

export class GovernanceModel {
	constructor(private readonly storage: GovernanceStorage) {}

	private async stored<T>(action: () => Promise<T>): Promise<T> {
		try {
			return await action();
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			if (!(error instanceof SqliteFailure)) {
				throw new AgentFailure('internal_failure', { cause: error });
			}
			if (error.kind === 'commit_unknown' || error.kind === 'rollback_failed') {
				throw new AgentFailure('operation_unknown', { cause: error });
			}
			if (
				error.kind === 'closed' ||
				error.kind === 'unavailable' ||
				error.kind === 'worker_exit' ||
				error.kind === 'busy'
			) {
				throw new AgentFailure('storage_unavailable', { cause: error });
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async grants(userId: number, appId: string): Promise<GrantState | null> {
		const row = await this.stored(() => this.storage.policy(userId, appId));
		return row === null ? null : appState(row);
	}

	async replaceGrants(
		userId: number,
		appId: string,
		expected: number,
		input: GrantInput[],
		now: number,
		decide: GrantChangeDecision,
	): Promise<GrantState | null> {
		const records: StoredGrant[] = input.map((g) => ({
			capability: g.capability,
			schemaVersion: 2,
			scope: fromScope(g.scope),
			grantedAt: now,
		}));
		const result = await this.stored(() =>
			this.storage.replaceGrants(userId, appId, expected, records, (current) => decide(appState(current))),
		);
		if (result.status === 'not_found') {
			return null;
		}
		if (result.status !== 'ok') {
			throw new AgentFailure('version_conflict');
		}
		return appState(result.policy);
	}

	async execution(userId: number, appId: string): Promise<ExecutionPolicyFacts | null> {
		const row = await this.stored(() => this.storage.policy(userId, appId));
		return row === null ? null : policyFacts(row);
	}

	async replaceExecution(
		userId: number,
		appId: string,
		version: number,
		overrides: PolicyOverrides,
		decide: ExecutionChangeDecision,
	): Promise<ExecutionPolicyFacts | null> {
		const result = await this.stored(() =>
			this.storage.replaceExecution(userId, appId, version, fromOverrides(overrides), (current) =>
				decide(policyFacts(current)),
			),
		);
		if (result.status === 'not_found') {
			return null;
		}
		if (result.status !== 'ok') {
			throw new AgentFailure('version_conflict');
		}
		return policyFacts(result.policy);
	}

	async approval(
		userId: number,
		appId: string,
		id: string,
		now: () => number,
		transition: ApprovalTransition,
	): Promise<Approval | null> {
		const row = await this.stored(() =>
			this.storage.getApproval(userId, appId, id, now, (stored, status, time) =>
				transition(fromApproval(stored), status, time),
			),
		);
		return row === null ? null : fromApproval(row);
	}

	async approvals(
		userId: number,
		appId: string,
		runId: string,
		now: () => number,
		transition: ApprovalTransition,
	): Promise<Approval[] | null> {
		const list = await this.stored(() =>
			this.storage.listApprovals(userId, appId, runId, now, (stored, status, time) =>
				transition(fromApproval(stored), status, time),
			),
		);
		if (list === 'limit_exceeded') {
			throw new AgentFailure('limit_exceeded');
		}
		return list === null ? null : list.map(fromApproval);
	}

	async request(input: ApprovalRequest, create: ApprovalRequestDecision): Promise<Approval | null> {
		const row = await this.stored(() =>
			this.storage.requestApproval(
				{ userId: input.userId, appId: input.appId, runId: input.runId },
				(stored, status, version) => {
					const fact = create(appState(stored), status, version);
					return fact === null ? null : toStoredApproval(fact);
				},
			),
		);
		return row === null ? null : fromApproval(row);
	}

	async resolve(
		input: ResolveApproval,
		hash: string,
		now: () => number,
		transition: ApprovalTransition,
		decide: ApprovalResolveDecision,
	): Promise<Approval> {
		const result = await this.stored(() =>
			this.storage.resolveApproval(
				{
					userId: input.userId,
					appId: input.appId,
					approvalId: input.approvalId,
					decision: input.decision,
					expectedVersion: input.expectedVersion,
					operationKey: input.operationKey,
					requestHash: hash,
					feedback: input.feedback ?? null,
				},
				now,
				(stored, status, time) => transition(fromApproval(stored), status, time),
				(stored, policy, status, version, time) =>
					decide(fromApproval(stored), appState(policy), status, version, time),
			),
		);
		if (result.status === 'not_found') {
			throw new AgentFailure('not_found');
		}
		if (result.status === 'version_conflict') {
			throw new AgentFailure('version_conflict');
		}
		if (result.status === 'idempotency_conflict') {
			throw new AgentFailure('idempotency_conflict');
		}
		if (result.status === 'approval_stale') {
			throw new AgentFailure('approval_stale');
		}
		if (result.status === 'ok' || result.status === 'replayed') {
			return fromApproval(result.approval);
		}
		throw new AgentFailure('internal_failure');
	}

	async invalidate(
		userId: number,
		appId: string,
		runId: string,
		now: () => number,
		transition: ApprovalTransition,
	): Promise<number> {
		return this.stored(() =>
			this.storage.invalidateRunApprovals(userId, appId, runId, now, (stored, status, time) =>
				transition(fromApproval(stored), status, time),
			),
		);
	}
}
