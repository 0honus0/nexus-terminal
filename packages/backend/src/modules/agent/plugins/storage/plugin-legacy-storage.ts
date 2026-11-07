import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export interface StoredLegacyPluginSummary {
	format: 'legacy-archive';
	packageId: string;
	version: string;
	displayName: string;
	capabilities: AgentCapability[];
}
