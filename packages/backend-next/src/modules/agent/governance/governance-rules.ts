import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
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
} from './model/governance-types.js';

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

export const DEFAULT_EXECUTION_POLICY: Required<PolicyOverrides> = {
	maxModelRequests: 80,
	maxAutoModelRequests: 400,
	maxAutoActiveExecutionSeconds: 7200,
	maxActiveExecutionSeconds: 1800,
	toolTimeoutSeconds: 60,
	maxToolOutputBytes: 65536,
	maxRecallItems: 5,
	maxRecallBytes: 8192,
	maxSubagentMessages: 1000,
	maxSubagentMessageBytes: 2097152,
	contextCompactionMode: 'balanced',
	contextProfile: 'normal',
};

export const HARD_EXECUTION_LIMITS: Readonly<
	Record<Exclude<keyof PolicyOverrides, 'contextCompactionMode' | 'contextProfile'>, number>
> = {
	maxModelRequests: 400,
	maxAutoModelRequests: 400,
	maxAutoActiveExecutionSeconds: 7200,
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

export function effectivePolicy(overrides: PolicyOverrides): Required<PolicyOverrides> {
	return { ...DEFAULT_EXECUTION_POLICY, ...overrides };
}

export function mayResolve(
	approval: Approval,
	policyRevision: number,
	runStatus: AgentRunStatus,
	runVersion: number,
	hash: string,
	version: number,
	now: number,
): boolean {
	return (
		approval.status === 'requested' &&
		approval.version === version &&
		approval.operationHash === hash &&
		approval.policyRevision === policyRevision &&
		approval.inputRevision === runVersion &&
		now < approval.expiresAt &&
		(runStatus === 'running' || runStatus === 'pending')
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

export function mayRequestApproval(
	runStatus: AgentRunStatus,
	runVersion: number,
	inputRevision: number,
	risk: Approval['inspection']['risk'],
	connectionId: number | null,
	inspectedConnectionId: number | null,
): boolean {
	return (
		(runStatus === 'running' || runStatus === 'pending') &&
		runVersion === inputRevision &&
		risk !== 'forbidden' &&
		connectionId === inspectedConnectionId &&
		(connectionId === null || (Number.isSafeInteger(connectionId) && connectionId > 0))
	);
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
		allowed: authorize(policy.grants, capability, connectionId),
	};
}
