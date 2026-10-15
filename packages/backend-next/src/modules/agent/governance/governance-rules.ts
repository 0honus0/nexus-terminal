import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { ToolOperation } from '../runs/model/run-tool-types.js';
import type { RunFrozenInput } from '../runs/model/run-types.js';
import type { ProviderRecord } from '../providers/model/provider-types.js';
import { mayExecuteFrozenRun } from '../runs/run-rules.js';

import {
	AGENT_CAPABILITIES,
	AGENT_TARGET_CAPABILITIES,
	AGENT_EXECUTION_INTEGER_KEYS,
	AGENT_GRANT_MAX_TARGET_IDS,
	AGENT_GRANT_MAX_ID_BYTES,
	AGENT_EXECUTION_COMPACTION_MODES,
	AGENT_EXECUTION_CONTEXT_PROFILES,
} from '@nexus-terminal/shared/agent/governance/values';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	Grant,
	GrantScope,
	PolicyOverrides,
	Approval,
	GrantInput,
	GrantState,
	AuthorizationFact,
	CapabilityDefinition,
	ToolAuthorityIdentity,
} from './model/governance-types.js';

export function toolAuthorityIdentity(operation: ToolOperation): ToolAuthorityIdentity {
	return {
		userId: operation.userId,
		appId: operation.appId,
		runId: operation.runId,
		id: operation.id,
		expectedRevision: operation.revision,
		operationHash: operation.operationHash,
	};
}

export function mayUseTool(
	operation: ToolOperation,
	policy: GrantState,
	status: AgentRunStatus,
	frozen: RunFrozenInput,
	provider: ProviderRecord | null,
	connectionIds: number[],
): boolean {
	return (
		status === 'running' &&
		operation.risk !== 'forbidden' &&
		(operation.targetId === null || connectionIds.includes(operation.targetId)) &&
		mayExecuteFrozenRun(frozen, provider) &&
		authorizationFact(policy, operation.capability, operation.targetId).allowed
	);
}

export function mayReadTool(
	operation: ToolOperation,
	policy: GrantState,
	status: AgentRunStatus,
	frozen: RunFrozenInput,
	provider: ProviderRecord | null,
	connectionIds: number[],
): boolean {
	return (
		operation.risk === 'read' &&
		!operation.mutation &&
		mayUseTool(operation, policy, status, frozen, provider, connectionIds)
	);
}

export function authorize(grants: readonly Grant[], capability: AgentCapability, connectionId: number | null): boolean {
	const grant = grants.find((g) => g.capability === capability);
	if (!grant) {
		return false;
	}
	if (!AGENT_TARGET_CAPABILITIES.includes(capability)) {
		return grant.scope.kind === 'global';
	}
	if (
		grant.scope.kind !== 'targets' ||
		connectionId === null ||
		!Number.isSafeInteger(connectionId) ||
		connectionId < 1
	) {
		return false;
	}
	const ssh = grant.scope.targets.ssh;
	return ssh !== undefined && (ssh.mode === 'all' || ssh.ids.includes(String(connectionId)));
}

export function validGrant(capability: AgentCapability, scope: GrantScope): boolean {
	if (!AGENT_TARGET_CAPABILITIES.includes(capability)) {
		return scope.kind === 'global';
	}
	return (
		scope.kind === 'targets' &&
		(scope.targets.ssh === undefined ||
			scope.targets.ssh.mode === 'all' ||
			(scope.targets.ssh.ids.length <= AGENT_GRANT_MAX_TARGET_IDS &&
				new Set(scope.targets.ssh.ids).size === scope.targets.ssh.ids.length &&
				scope.targets.ssh.ids.every(
					(id) =>
						/^[1-9][0-9]*$/.test(id) &&
						Number.isSafeInteger(Number(id)) &&
						new TextEncoder().encode(id).length <= AGENT_GRANT_MAX_ID_BYTES,
				)))
	);
}

export function mayReplaceGrants(
	grants: readonly GrantInput[],
	currentRevision: number,
	expectedRevision: number,
): boolean {
	return (
		currentRevision === expectedRevision &&
		new Set(grants.map((g) => g.capability)).size === grants.length &&
		grants.every((g) => validGrant(g.capability, g.scope))
	);
}

export function grantChangeDecision(
	grants: readonly GrantInput[],
	currentRevision: number,
	expectedRevision: number,
): { allow: boolean; pendingStatus: 'superseded' | null } {
	return {
		allow: mayReplaceGrants(grants, currentRevision, expectedRevision),
		pendingStatus: currentRevision === expectedRevision ? 'superseded' : null,
	};
}

export const HARD_EXECUTION_LIMITS: Readonly<
	Record<Exclude<keyof PolicyOverrides, 'contextCompactionMode' | 'contextProfile'>, number>
> = {
	maxModelRequests: 400,
	maxActiveExecutionSeconds: 7200,
	toolTimeoutSeconds: 300,
	maxToolOutputBytes: 262144,
	maxRecallItems: 20,
	maxRecallBytes: 32768,
	maxSubagentMessages: 5000,
	maxSubagentMessageBytes: 8388608,
};

export function validOverrides(value: PolicyOverrides): boolean {
	for (const key of AGENT_EXECUTION_INTEGER_KEYS) {
		const item = value[key];
		if (item !== undefined && (!Number.isSafeInteger(item) || item < 1 || item > HARD_EXECUTION_LIMITS[key])) {
			return false;
		}
	}
	return (
		(value.contextCompactionMode === undefined ||
			AGENT_EXECUTION_COMPACTION_MODES.includes(value.contextCompactionMode)) &&
		(value.contextProfile === undefined || AGENT_EXECUTION_CONTEXT_PROFILES.includes(value.contextProfile))
	);
}

export function executionChangeDecision(
	currentVersion: number,
	expectedVersion: number,
	current: PolicyOverrides,
	next: PolicyOverrides,
): { allow: boolean; pendingStatus: 'superseded' | null } {
	return {
		allow: currentVersion === expectedVersion && validOverrides(current) && validOverrides(next),
		pendingStatus: currentVersion === expectedVersion ? 'superseded' : null,
	};
}

export function mayResolve(
	approval: Approval,
	policyRevision: number,
	runStatus: AgentRunStatus,
	operationRevision: number,
	hash: string,
	version: number,
	now: number,
): boolean {
	return (
		approval.status === 'requested' &&
		approval.version === version &&
		approval.operationHash === hash &&
		approval.policyRevision === policyRevision &&
		approval.inputRevision === operationRevision &&
		now < approval.expiresAt &&
		(runStatus === 'running' || runStatus === 'pending')
	);
}

export function mayUseConsumedApproval(
	approval: Approval,
	operation: ToolOperation,
	policy: GrantState,
	now: number,
): boolean {
	return (
		approval.status === 'approved' &&
		approval.kind === (operation.toolName === 'acp_inner_permission' ? 'acp_permission' : 'tool') &&
		approval.userId === operation.userId &&
		approval.appId === operation.appId &&
		approval.runId === operation.runId &&
		approval.toolCallId === operation.id &&
		approval.consumedAt !== null &&
		now < approval.expiresAt &&
		approval.policyRevision === policy.revision &&
		approval.inputRevision === operation.operationRevision &&
		approval.operationHash === operation.operationHash &&
		approval.capability === operation.capability &&
		approval.targetVersion === operation.targetVersion &&
		approval.inspection.targetConnectionId === operation.targetId &&
		approval.inspection.risk === operation.risk &&
		approval.inspection.mutation === operation.mutation &&
		approval.inspection.toolName === operation.toolName &&
		approval.inspection.toolVersion === operation.toolVersion &&
		approval.inspection.summary === operation.summary
	);
}

export function mayConsumeApproval(
	approval: Approval,
	policy: GrantState,
	runStatus: AgentRunStatus,
	operationRevision: number,
	now: number,
): boolean {
	return (
		approval.status === 'approved' &&
		approval.kind === (approval.inspection.toolName === 'acp_inner_permission' ? 'acp_permission' : 'tool') &&
		approval.inspection.risk !== 'forbidden' &&
		approval.consumedAt === null &&
		approval.policyRevision === policy.revision &&
		approval.inputRevision === operationRevision &&
		now < approval.expiresAt &&
		(runStatus === 'pending' || runStatus === 'running') &&
		authorizationFact(policy, approval.capability, approval.inspection.targetConnectionId).allowed
	);
}

export function approvalTransition(
	approval: Approval,
	runStatus: AgentRunStatus,
	now: number,
): 'expired' | 'superseded' | null {
	if (approval.status !== 'requested') {
		return null;
	}
	if (now >= approval.expiresAt) {
		return 'expired';
	}
	if (runStatus === 'cancelled' || runStatus === 'completed' || runStatus === 'failed' || runStatus === 'unknown') {
		return 'superseded';
	}
	return null;
}

export function mayRequestApproval(runStatus: AgentRunStatus, risk: Approval['inspection']['risk']): boolean {
	return (runStatus === 'running' || runStatus === 'pending') && risk !== 'forbidden';
}

export function capabilityDefinitions(): CapabilityDefinition[] {
	return AGENT_CAPABILITIES.map((id): CapabilityDefinition => {
		if (AGENT_TARGET_CAPABILITIES.includes(id)) {
			return {
				id,
				scopeKind: 'targets',
				supportedTargets: ['ssh'],
				defaultScope: { kind: 'targets', targets: { ssh: { mode: 'all' } } },
			};
		}
		return { id, scopeKind: 'global', supportedTargets: [], defaultScope: { kind: 'global' } };
	});
}

export function authorizationFact(
	policy: GrantState,
	capability: AgentCapability,
	connectionId: number | null,
): AuthorizationFact {
	return {
		userId: policy.userId,
		appId: policy.appId,
		capability,
		connectionId,
		revision: policy.revision,
		allowed:
			policy.app.declared &&
			policy.app.enabled &&
			policy.app.capabilities.includes(capability) &&
			(connectionId === null || !policy.app.deniedTargetIds.includes(connectionId)) &&
			authorize(policy.grants, capability, connectionId),
	};
}
