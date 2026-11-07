import type { AgentOperationErrorCode } from '../values.js';
import type { AgentCapability } from '../governance/values.js';
import type { AgentPluginPackageReference } from './model.js';

export const AGENT_PLUGIN_CALLABLE_KINDS = ['app', 'tool', 'service'] as const;

export type AgentPluginCallableKind = (typeof AGENT_PLUGIN_CALLABLE_KINDS)[number];

/** Business contracts are owned by their publisher, independently of the Host SDK. */
export interface AgentPluginCallableDefinition {
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

export type AgentPluginEventSource =
	{ kind: 'transient' } | { kind: 'snapshot'; callableKey: string } | { kind: 'cursor'; callableKey: string };

export interface AgentPluginEventDefinition {
	kind: 'event';
	key: string;
	contract: string;
	apiVersion: number;
	summary: string;
	payloadSchemaJson: string;
	source: AgentPluginEventSource;
}

export type AgentPluginRegistrationDefinition = AgentPluginCallableDefinition | AgentPluginEventDefinition;

export interface AgentPluginRegistryEntry {
	id: string;
	instanceId: string;
	package: AgentPluginPackageReference;
	generation: string;
	key: string;
	kind: AgentPluginRegistrationDefinition['kind'];
	contract: string;
	apiVersion: number;
	summary: string;
	tags: string[];
}

export interface AgentPluginDirectoryPage {
	revision: number;
	entries: AgentPluginRegistryEntry[];
	nextCursor: string | null;
}

export interface AgentPluginBinding {
	id: string;
	entryId: string;
	instanceId: string;
	generation: string;
	configurationRevision: number;
	schemaSha256: string;
}

export interface AgentPluginDescription {
	entry: AgentPluginRegistryEntry;
	definition: AgentPluginRegistrationDefinition;
	schemaSha256: string;
}

export interface AgentPluginInvocation {
	bindingId: string;
	operationKey: string;
	argumentsJson: string;
}

export type AgentPluginInvocationReply =
	| { kind: 'completed'; operationId: string | null; resultJson: string }
	| { kind: 'rejected'; code: AgentOperationErrorCode }
	| { kind: 'interrupted'; operationId: string; reason: 'cancelled' | 'effect_unknown' | 'cleanup_failed' };

export interface AgentPluginInstanceEvent {
	instanceId: string;
	generation: string;
	key: string;
	revision: number;
	cursor: string | null;
	payloadJson: string;
}
