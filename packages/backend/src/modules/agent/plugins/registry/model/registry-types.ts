import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentPluginCallableKind } from '@nexus-terminal/shared/agent/plugins/registry';

export interface RegistryScope {
	userId: number;
	appId: string;
}

export interface RegistryCaller extends RegistryScope {
	/** Host-derived invocation/Run/Surface owner; never selected by plugin arguments. */
	ownerId: string;
	visibleInstanceIds: readonly string[];
	visibleToolInstanceIds: readonly string[];
	visibleToolKeys: readonly string[] | null;
	capabilities: readonly AgentCapability[];
}

export interface RegistryPackage {
	packageId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
}

export interface RegistryProvider extends RegistryScope {
	packageRevision: number;
	instanceId: string;
	generation: string;
	configurationRevision: number;
	package: RegistryPackage;
	namespaces: readonly string[];
	appEntry: string | null;
	tools: boolean;
	services: boolean;
	capabilities: readonly AgentCapability[];
}

export interface RegistryCallable {
	kind: AgentPluginCallableKind;
	key: string;
	contract: string;
	apiVersion: number;
	summary: string;
	instructions: string;
	inputSchemaJson: string;
	resultSchemaJson: string;
	capabilities: AgentCapability[];
	tags: string[];
	execution: 'pure' | 'managed';
}

export interface RegistryEvent {
	kind: 'event';
	key: string;
	contract: string;
	apiVersion: number;
	summary: string;
	payloadSchemaJson: string;
	source: { kind: 'transient' } | { kind: 'snapshot' | 'cursor'; callableKey: string };
}

export type RegistryDefinition = RegistryCallable | RegistryEvent;

export interface RegistryEntry {
	id: string;
	instanceId: string;
	package: RegistryPackage;
	generation: string;
	key: string;
	kind: RegistryDefinition['kind'];
	contract: string;
	apiVersion: number;
	summary: string;
	tags: string[];
}

export interface RegistryBinding {
	id: string;
	entryId: string;
	instanceId: string;
	generation: string;
	configurationRevision: number;
	schemaSha256: string;
}

export interface RegistryDescription {
	entry: RegistryEntry;
	definition: RegistryDefinition;
	schemaSha256: string;
}

export interface RegistryPage {
	revision: number;
	entries: RegistryEntry[];
	nextCursor: string | null;
}

export interface RegistryQuery {
	contract: string | null;
	apiVersion: number | null;
	kind: RegistryDefinition['kind'] | null;
	cursor: string | null;
}

export interface RegistryEventValue {
	instanceId: string;
	generation: string;
	key: string;
	revision: number;
	cursor: string | null;
	payloadJson: string;
}

export interface RegistryBoundCallable {
	binding: RegistryBinding;
	provider: RegistryProvider;
	definition: RegistryCallable;
}

export interface RegistryResolvedCall extends RegistryBoundCallable {
	argumentsJson: string;
	validateResult(resultJson: string): string;
}
