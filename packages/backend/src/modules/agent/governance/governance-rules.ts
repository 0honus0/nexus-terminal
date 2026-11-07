import { AGENT_EXECUTION_LIMIT_MAXIMA } from '@nexus-terminal/shared/agent/execution/values';

import {
	AGENT_CAPABILITIES,
	AGENT_TARGET_CAPABILITIES,
	AGENT_EXECUTION_INTEGER_KEYS,
	AGENT_GRANT_MAX_ID_BYTES,
} from '@nexus-terminal/shared/agent/governance/values';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	Grant,
	GrantScope,
	PolicyOverrides,
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
			(new Set(scope.targets.ssh.ids).size === scope.targets.ssh.ids.length &&
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

export const HARD_EXECUTION_LIMITS: Readonly<Record<keyof PolicyOverrides, number>> = {
	maxModelRequests: AGENT_EXECUTION_LIMIT_MAXIMA.maxModelRequests,
	maxActiveExecutionSeconds: AGENT_EXECUTION_LIMIT_MAXIMA.maxActiveSeconds,
	toolTimeoutSeconds: AGENT_EXECUTION_LIMIT_MAXIMA.toolTimeoutSeconds,
	maxToolOutputBytes: AGENT_EXECUTION_LIMIT_MAXIMA.maxToolOutputBytes,
	maxRecallItems: AGENT_EXECUTION_LIMIT_MAXIMA.maxRecallItems,
	maxRecallBytes: AGENT_EXECUTION_LIMIT_MAXIMA.maxRecallBytes,
	maxSubagentMessages: AGENT_EXECUTION_LIMIT_MAXIMA.maxMessages,
	maxSubagentMessageBytes: AGENT_EXECUTION_LIMIT_MAXIMA.maxMessageBytes,
};

export function validOverrides(value: PolicyOverrides): boolean {
	for (const key of AGENT_EXECUTION_INTEGER_KEYS) {
		const item = value[key];
		if (item !== undefined && (!Number.isSafeInteger(item) || item < 1 || item > HARD_EXECUTION_LIMITS[key])) {
			return false;
		}
	}
	return true;
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
