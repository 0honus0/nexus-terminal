import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { PluginActor, PluginManifest } from './plugin-types.js';
import type { PluginPackageReference } from './plugin-composition-types.js';
import type { PluginInvocationParticipant } from './plugin-run-types.js';

export interface PluginInstance {
	id: string;
	appId: string;
	packageId: string;
	name: string;
	selected: boolean;
	enabled: boolean;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface PluginConfiguration {
	instanceId: string;
	packageId: string;
	revision: number;
	schemaRevision: number;
	documentJson: string;
}

export interface PluginInstanceSource {
	instance: PluginInstance;
	configuration: PluginConfiguration;
	package: PluginPackageReference;
	packageRevision: number;
	manifest: PluginManifest;
}

export type PluginConfigurationPrincipal =
	| { kind: 'manual'; actor: PluginActor }
	| {
			kind: 'run';
			userId: number;
			appId: string;
			runId: string;
			executionGeneration: string;
			operationId: string | null;
			policyRevision: number;
			callerInstanceId: string;
			callerGeneration: string;
			participants: readonly PluginInvocationParticipant[];
			capabilities: readonly AgentCapability[];
	  };

export interface PluginConfigurationWrite {
	operationKey: string;
	expectedPackageRevision: number;
	expectedRevision: number;
	schemaRevision: number;
	documentJson: string;
}

export interface PluginConfigurationMutation {
	configuration: PluginConfiguration;
	changed: boolean;
}
