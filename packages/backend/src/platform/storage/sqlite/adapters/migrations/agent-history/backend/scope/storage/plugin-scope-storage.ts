// Frozen published database migration dependency. Not an application API.
import type { AgentCapability } from '../../../contracts/governance/values.js';

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
