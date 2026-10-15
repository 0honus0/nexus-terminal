import type { StoredExecutionSettings } from '../../execution/storage/execution-storage.js';
import { fromSettings } from '../../execution/model/execution-projection.js';
import type { StoredToolAuthorityDecision } from '../storage/governance-storage.js';
import type { DenylistChangeDecision, DenylistMutation } from './governance-types.js';
import type {
	ToolAuthorityIdentity,
	ToolAuthorityTask,
	ToolAuthorityDecision,
	ToolPermitDecision,
	ToolAuthority,
} from './governance-types.js';
import { fromStoredFrozen } from '../../runs/model/run-projection.js';
import { fromStoredProvider } from '../../providers/model/provider-projection.js';
import type { AppPolicyFacts } from './governance-types.js';
import type { StoredAppPolicyFacts } from '../storage/governance-storage.js';
import type { ConnectionCatalog } from '../../../targets/public.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import type { StoredTargetDenylist } from '../storage/governance-storage.js';
import type { TargetDenylist, DenylistTarget } from './governance-types.js';
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
import { agentStorage } from '../../agent-storage-failure.js';
import { fromStoredTool } from '../../runs/model/run-tool-model.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { ConsumeApproval } from './governance-types.js';

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

export function toPolicyOverrides(row: StoredPolicyOverrides): PolicyOverrides {
	const result: PolicyOverrides = {};
	if (row.maxModelRequests !== undefined) {
		result.maxModelRequests = row.maxModelRequests;
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
	capability: approval.capability,
	targetVersion: approval.targetVersion,
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
	capability: a.capability,
	targetVersion: a.targetVersion,
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
	app: fromAppPolicy(stored.app),
	appId: stored.appId,
	userId: stored.userId,
	revision: stored.revision,
	grants: stored.grants.map(toGrant),
});

const policyFacts = (stored: StoredPolicy, settings: StoredExecutionSettings | null): ExecutionPolicyFacts => ({
	settings: settings === null ? null : fromSettings(settings),
	app: fromAppPolicy(stored.app),
	version: stored.executionVersion,
	overrides: toPolicyOverrides(stored.overrides),
});

export class GovernanceModel {
	constructor(
		private readonly storage: GovernanceStorage,
		private readonly targets: ConnectionCatalog,
	) {}

	async toolAuthority(
		input: ToolAuthorityIdentity,
		task: ToolAuthorityTask,
		decide: ToolAuthorityDecision,
		permit: ToolPermitDecision,
	): Promise<ToolAuthority | null> {
		const result = await agentStorage(() =>
			this.storage.toolAuthority(
				{
					userId: input.userId,
					appId: input.appId,
					runId: input.runId,
					id: input.id,
					expectedRevision: input.expectedRevision,
					operationHash: input.operationHash,
				},
				task.kind === 'complete'
					? {
							kind: 'complete',
							policyRevision: task.policyRevision,
							resultText: task.resultText,
							targets: task.targets.map((target) => ({ id: target.id, version: target.version })),
						}
					: task.kind === 'verify'
						? { kind: 'verify', policyRevision: task.policyRevision }
						: task.kind === 'inspect'
							? { kind: 'inspect', policyRevision: task.policyRevision }
							: { kind: 'dispatch' },
				Date.now,
				toStoredAuthorityDecision(decide),
				(approval, operation, policy, time) =>
					permit(fromApproval(approval), fromStoredTool(operation), appState(policy), time),
			),
		);
		return result === null
			? null
			: {
					operation: fromStoredTool(result.operation),
					policy: appState(result.policy),
					connectionIds: result.connectionIds.map((id) => id),
				};
	}

	async consume(
		input: ConsumeApproval,
		now: () => number,
		decide: ApprovalResolveDecision,
		authorize: ToolAuthorityDecision,
	): Promise<ToolOperation> {
		const result = await agentStorage(() =>
			this.storage.consumeApproval(
				{
					userId: input.userId,
					appId: input.appId,
					approvalId: input.approvalId,
					expectedVersion: input.expectedVersion,
				},
				() => {
					const milliseconds = now();
					return { approvalTime: Math.floor(milliseconds / 1000), operationTime: milliseconds };
				},
				(approval, policy, status, revision, time) =>
					decide(fromApproval(approval), appState(policy), status, revision, time),
				toStoredAuthorityDecision(authorize),
			),
		);
		if (result === 'approval_stale') {
			throw new AgentFailure('approval_stale');
		}
		return fromStoredTool(result);
	}

	async denylist(): Promise<TargetDenylist> {
		return fromDenylist(await agentStorage(() => this.storage.denylist()));
	}

	async target(id: number): Promise<DenylistTarget | null> {
		try {
			const target = await this.targets.get(id);
			return target === null ? null : { id: target.id, version: target.version };
		} catch (error) {
			if (error instanceof TargetOperationError) {
				throw new AgentFailure(
					error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
					{ cause: error },
				);
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async replaceDenylist(
		userId: number,
		expectedRevision: number,
		targets: DenylistTarget[],
		reason: string,
		now: () => number,
		decide: DenylistChangeDecision,
	): Promise<DenylistMutation> {
		const result = await agentStorage(() =>
			this.storage.replaceDenylist(
				{
					userId,
					expectedRevision,
					targets: targets.map((target) => ({ id: target.id, version: target.version })),
					reason,
				},
				now,
				(stored) => {
					const task = decide(fromDenylist(stored));
					return { revoke: task.revoke };
				},
			),
		);
		if (result === 'version_conflict' || result === 'not_found') {
			throw new AgentFailure(result);
		}
		return { value: fromDenylist(result.value), revokedRuns: result.revokedRuns };
	}

	async grants(userId: number, appId: string): Promise<GrantState | null> {
		const row = await agentStorage(() => this.storage.policy(userId, appId));
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
		const records = input.map((grant) => toStoredGrant(grant, now));
		const result = await agentStorage(() =>
			this.storage.replaceGrants(userId, appId, expected, records, (current) => {
				const task = decide(appState(current));
				return { allow: task.allow, pendingStatus: task.pendingStatus };
			}),
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
		const row = await agentStorage(() => this.storage.execution(userId, appId));
		return row === null ? null : policyFacts(row.policy, row.settings);
	}

	async replaceExecution(
		userId: number,
		appId: string,
		version: number,
		overrides: PolicyOverrides,
		decide: ExecutionChangeDecision,
	): Promise<ExecutionPolicyFacts | null> {
		const result = await agentStorage(() =>
			this.storage.replaceExecution(userId, appId, version, fromOverrides(overrides), (current, settings) => {
				const task = decide(policyFacts(current, settings));
				return { allow: task.allow, pendingStatus: task.pendingStatus };
			}),
		);
		if (result.status === 'not_found') {
			return null;
		}
		if (result.status !== 'ok') {
			throw new AgentFailure('version_conflict');
		}
		return policyFacts(result.policy, result.settings);
	}

	async approval(
		userId: number,
		appId: string,
		id: string,
		now: () => number,
		transition: ApprovalTransition,
	): Promise<Approval | null> {
		const row = await agentStorage(() =>
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
		const list = await agentStorage(() =>
			this.storage.listApprovals(userId, appId, runId, now, (stored, status, time) =>
				transition(fromApproval(stored), status, time),
			),
		);
		if (list === 'limit_exceeded') {
			throw new AgentFailure('limit_exceeded');
		}
		return list === null ? null : list.map(fromApproval);
	}

	async request(
		input: ApprovalRequest,
		create: ApprovalRequestDecision,
		authorize: ToolAuthorityDecision,
	): Promise<Approval | null> {
		const row = await agentStorage(() =>
			this.storage.requestApproval(
				{
					userId: input.userId,
					appId: input.appId,
					runId: input.runId,
					toolCallId: input.toolCallId,
				},
				(stored, status, operation) => {
					const fact = create(appState(stored), status, {
						id: operation.id,
						operationHash: operation.operationHash,
						operationRevision: operation.operationRevision,
						capability: operation.capability,
						targetVersion: operation.targetVersion,
						inspection: {
							toolName: operation.toolName,
							toolVersion: operation.toolVersion,
							risk: operation.risk,
							mutation: operation.mutation,
							targetConnectionId: operation.targetId,
							summary: operation.summary,
						},
					});
					return fact === null ? null : toStoredApproval(fact);
				},
				toStoredAuthorityDecision(authorize),
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
		const result = await agentStorage(() =>
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
		return agentStorage(() =>
			this.storage.invalidateRunApprovals(userId, appId, runId, now, (stored, status, time) =>
				transition(fromApproval(stored), status, time),
			),
		);
	}
}

export function toStoredGrant(grant: GrantInput, grantedAt: number): StoredGrant {
	return { capability: grant.capability, schemaVersion: 2, scope: fromScope(grant.scope), grantedAt };
}

function fromDenylist(stored: StoredTargetDenylist): TargetDenylist {
	return {
		revision: stored.revision,
		entries: stored.entries.map((entry) => ({
			connectionId: entry.connectionId,
			reason: entry.reason,
			changedBy: entry.changedBy,
			changedAt: entry.changedAt,
		})),
	};
}

function fromAppPolicy(stored: StoredAppPolicyFacts): AppPolicyFacts {
	return {
		enabled: stored.enabled,
		declared: stored.declared,
		capabilities: stored.capabilities.map((capability) => capability),
		deniedTargetIds: stored.deniedTargetIds.map((id) => id),
	};
}

function toStoredAuthorityDecision(decide: ToolAuthorityDecision): StoredToolAuthorityDecision {
	return (operation, policy, status, frozen, provider, ids) =>
		decide(
			fromStoredTool(operation),
			appState(policy),
			status,
			fromStoredFrozen(frozen),
			provider === null ? null : fromStoredProvider(provider),
			ids.map((id) => id),
		);
}
