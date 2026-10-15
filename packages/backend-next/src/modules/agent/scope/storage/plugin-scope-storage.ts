import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

/** Independent storage task; package provenance and grant policy belong to their respective owners. */
export interface StoredPluginScopeActivation {
	userId: number;
	appId: string;
	definitionId: string;
	definitionVersion: string;
	displayName: string;
	contentHash: string;
	capabilities: AgentCapability[];
	now: number;
}
