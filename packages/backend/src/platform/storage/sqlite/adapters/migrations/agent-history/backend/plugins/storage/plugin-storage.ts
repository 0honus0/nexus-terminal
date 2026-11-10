// Frozen published database migration dependency. Not an application API.
import type { StoredPluginSignedContribution, StoredPluginPackageDependency } from './plugin-manifest-storage.js';

import type { AgentCapability } from '../../../contracts/governance/values.js';

export interface StoredPluginManifest {
	schemaVersion: 4;
	id: string;
	version: string;
	displayName: string;
	requiredOnEnable?: boolean;
	compatibility: {
		host: {
			minVersion: string;
			maxVersion: string;
		};
		backendSdk: number | null;
		frontendSdk: number | null;
	};
	contributions: StoredPluginSignedContribution;
	capabilities: AgentCapability[];
	intents: {
		id: string;
		schemaVersion: number;
	}[];
	frontendEntry: string | null;
	backendEntry: string | null;
	dependencies: StoredPluginPackageDependency[];
	namespaces: string[];
}
