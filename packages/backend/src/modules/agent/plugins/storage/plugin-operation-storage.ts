import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { AgentCapability, AgentApprovalRisk } from '@nexus-terminal/shared/agent/governance/values';

/** Persisted identity, never an administrator session or a reusable plugin name. */
export interface StoredPluginOperationAuthority {
	userId: number;
	appId: string;
	packageId: string;
	installationRevision: number;
	instanceId: string;
	instanceRevision: number;
}

export interface StoredPluginToolFacts {
	toolName: string;
	toolVersion: string;
	argumentsJson: string;
	identity: AgentToolIdentity;
	requiredCapabilities: AgentCapability[];
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	mutation: boolean;
	targetId: number | null;
	targetVersion: number | null;
}
