// Frozen published database migration dependency. Not an application API.
import type { AgentCapability } from '../governance/values.js';

export interface AgentPluginCompatibility {
	host: {
		minVersion: string;
		maxVersion: string;
	};
	backendSdk: number | null;
	frontendSdk: number | null;
}

export interface AgentPluginManifest {
	schemaVersion: 4;
	id: string;
	version: string;
	displayName: string;
	requiredOnEnable?: boolean;
	compatibility: AgentPluginCompatibility;
	capabilities: AgentCapability[];
	intents: {
		id: string;
		schemaVersion: number;
	}[];
	frontendEntry: string | null;
	backendEntry: string | null;
	contributions: import('./agent-extension.js').AgentPluginContribution;
	dependencies: import('./agent-extension.js').AgentPluginPackageDependency[];
	namespaces: string[];
}
