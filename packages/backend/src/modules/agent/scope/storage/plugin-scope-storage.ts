import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export interface StoredPluginScopePackage {
	packageId: string;
	kind: 'app' | 'tool';
	version: string;
	packageHash: string;
	publisherKeyId: string;
}

/** Independent storage task; package provenance and grant policy belong to their respective owners. */
export interface StoredPluginScopeActivation {
	mode: 'install' | 'selection' | 'provider';
	userId: number;
	appId: string;
	definitionId: string;
	definitionVersion: string;
	displayName: string;
	contentHash: string;
	capabilities: AgentCapability[];
	executionPackages: StoredPluginScopePackage[];
	enabled: boolean;
	grantedCapabilities: AgentCapability[] | null;
	now: number;
}
