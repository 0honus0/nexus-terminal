import type { AgentAppView, AgentAppDefinitionView } from '@nexus-terminal/shared/agent/scope/model';
import type {
	AgentExecutionPolicyOverrides,
	AgentExecutionPolicyView,
	AgentGrantScope,
	AgentGrantView,
	AgentTargetDenylistView,
} from '@nexus-terminal/shared/agent/governance/model';
import type { AgentGrantReplaceRequest } from '@nexus-terminal/shared/agent/governance/http';
import type {
	AgentDenylist,
	AppDefinition,
	AppExecutionPolicy,
	AppGrantInput,
	AppGrants,
	AppGrantScope,
	AppPolicyOverrides,
	ManagedApp,
} from './app-management-types';
import { AGENT_EXECUTION_INTEGER_KEYS } from '@nexus-terminal/shared/agent/governance/values';

export function fromManagedApp(value: AgentAppView): ManagedApp {
	return {
		id: value.id,
		name: value.name,
		definitionId: value.definitionId,
		definitionVersion: value.definitionVersion,
		capabilities: value.capabilities.map((capability) => capability),
		enabled: value.enabled,
		version: value.version,
		executionState: value.executionState,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromAppDefinition(value: AgentAppDefinitionView): AppDefinition {
	return {
		id: value.id,
		version: value.version,
		name: value.displayName,
		capabilities: value.capabilities.map((capability) => capability),
		defaultEnabled: value.defaultEnabled,
	};
}

function fromGrantScope(value: AgentGrantScope): AppGrantScope {
	if (value.kind === 'global') {
		return { kind: 'global' };
	}
	const ssh = value.targets.ssh;
	return {
		kind: 'targets',
		ssh:
			ssh === undefined
				? null
				: ssh.mode === 'all'
					? { mode: 'all' }
					: { mode: 'ids', ids: ssh.ids.map((id) => id) },
	};
}

function toGrantScope(value: AppGrantScope): AgentGrantScope {
	if (value.kind === 'global') {
		return { kind: 'global' };
	}
	if (value.ssh === null) {
		return { kind: 'targets', targets: {} };
	}
	return {
		kind: 'targets',
		targets: {
			ssh: value.ssh.mode === 'all' ? { mode: 'all' } : { mode: 'ids', ids: value.ssh.ids.map((id) => id) },
		},
	};
}

export function fromAppGrants(value: AgentGrantView): AppGrants {
	return {
		appId: value.appId,
		revision: value.policyRevision,
		definitions: value.definitions.map((definition) => ({
			id: definition.id,
			scopeKind: definition.scopeKind,
			defaultScope: fromGrantScope(definition.defaultScope),
		})),
		grants: value.grants.map((grant) => ({
			capability: grant.capability,
			scope: fromGrantScope(grant.scope),
			grantedAt: grant.grantedAt,
		})),
	};
}

export function toAppGrants(grants: AppGrantInput[], revision: number): AgentGrantReplaceRequest {
	return {
		expectedPolicyRevision: revision,
		grants: grants.map((grant) => ({ capability: grant.capability, scope: toGrantScope(grant.scope) })),
	};
}

export function toAppPolicy(value: AppPolicyOverrides): AgentExecutionPolicyOverrides {
	const overrides: AgentExecutionPolicyOverrides = {};
	for (const key of AGENT_EXECUTION_INTEGER_KEYS) {
		if (value[key] !== undefined) {
			overrides[key] = value[key];
		}
	}
	if (value.contextCompactionMode !== undefined) {
		overrides.contextCompactionMode = value.contextCompactionMode;
	}
	if (value.contextProfile !== undefined) {
		overrides.contextProfile = value.contextProfile;
	}
	return overrides;
}

export function fromAppPolicy(value: AgentExecutionPolicyView): AppExecutionPolicy {
	return {
		version: value.version,
		overrides: {
			maxModelRequests: value.overrides.maxModelRequests,
			maxActiveExecutionSeconds: value.overrides.maxActiveExecutionSeconds,
			toolTimeoutSeconds: value.overrides.toolTimeoutSeconds,
			maxToolOutputBytes: value.overrides.maxToolOutputBytes,
			maxRecallItems: value.overrides.maxRecallItems,
			maxRecallBytes: value.overrides.maxRecallBytes,
			maxSubagentMessages: value.overrides.maxSubagentMessages,
			maxSubagentMessageBytes: value.overrides.maxSubagentMessageBytes,
			contextCompactionMode: value.overrides.contextCompactionMode,
			contextProfile: value.overrides.contextProfile,
		},
		effective: {
			maxModelRequests: value.effective.maxModelRequests,
			maxActiveExecutionSeconds: value.effective.maxActiveExecutionSeconds,
			toolTimeoutSeconds: value.effective.toolTimeoutSeconds,
			maxToolOutputBytes: value.effective.maxToolOutputBytes,
			maxRecallItems: value.effective.maxRecallItems,
			maxRecallBytes: value.effective.maxRecallBytes,
			maxSubagentMessages: value.effective.maxSubagentMessages,
			maxSubagentMessageBytes: value.effective.maxSubagentMessageBytes,
			contextCompactionMode: value.effective.contextCompactionMode,
			contextProfile: value.effective.contextProfile,
		},
	};
}

export function fromAgentDenylist(value: AgentTargetDenylistView): AgentDenylist {
	return {
		revision: value.revision,
		entries: value.entries.map((entry) => ({
			connectionId: entry.connectionId,
			reason: entry.reason,
			changedBy: entry.changedBy,
			changedAt: entry.changedAt * 1000,
		})),
	};
}
