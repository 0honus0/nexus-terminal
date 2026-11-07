import type {
	AgentPluginRegistrationDefinition,
	AgentPluginRegistryEntry,
	AgentPluginDescription,
	AgentPluginBinding,
	AgentPluginDirectoryPage,
} from '@nexus-terminal/shared/agent/plugins/registry';
import type {
	RegistryDefinition,
	RegistryEntry,
	RegistryDescription,
	RegistryBinding,
	RegistryPage,
} from './registry-types.js';

export function fromRegistryDefinition(value: AgentPluginRegistrationDefinition): RegistryDefinition {
	if (value.kind === 'event') {
		return {
			kind: 'event',
			key: value.key,
			contract: value.contract,
			apiVersion: value.apiVersion,
			summary: value.summary,
			payloadSchemaJson: value.payloadSchemaJson,
			source:
				value.source.kind === 'transient'
					? { kind: 'transient' }
					: { kind: value.source.kind, callableKey: value.source.callableKey },
		};
	}
	return {
		kind: value.kind,
		key: value.key,
		contract: value.contract,
		apiVersion: value.apiVersion,
		summary: value.summary,
		instructions: value.instructions,
		inputSchemaJson: value.inputSchemaJson,
		resultSchemaJson: value.resultSchemaJson,
		capabilities: value.capabilities.map((capability) => capability),
		tags: value.tags.map((tag) => tag),
		execution: value.execution,
	};
}

export function toRegistryDefinition(value: RegistryDefinition): AgentPluginRegistrationDefinition {
	if (value.kind === 'event') {
		return {
			kind: 'event',
			key: value.key,
			contract: value.contract,
			apiVersion: value.apiVersion,
			summary: value.summary,
			payloadSchemaJson: value.payloadSchemaJson,
			source:
				value.source.kind === 'transient'
					? { kind: 'transient' }
					: { kind: value.source.kind, callableKey: value.source.callableKey },
		};
	}
	return {
		kind: value.kind,
		key: value.key,
		contract: value.contract,
		apiVersion: value.apiVersion,
		summary: value.summary,
		instructions: value.instructions,
		inputSchemaJson: value.inputSchemaJson,
		resultSchemaJson: value.resultSchemaJson,
		capabilities: value.capabilities.map((capability) => capability),
		tags: value.tags.map((tag) => tag),
		execution: value.execution,
	};
}

export function toRegistryEntry(value: RegistryEntry): AgentPluginRegistryEntry {
	return {
		id: value.id,
		instanceId: value.instanceId,
		generation: value.generation,
		key: value.key,
		kind: value.kind,
		contract: value.contract,
		apiVersion: value.apiVersion,
		summary: value.summary,
		tags: value.tags.map((tag) => tag),
		package: {
			packageId: value.package.packageId,
			version: value.package.version,
			packageHash: value.package.packageHash,
			publisherKeyId: value.package.publisherKeyId,
		},
	};
}

export function toRegistryDescription(value: RegistryDescription): AgentPluginDescription {
	return {
		entry: toRegistryEntry(value.entry),
		definition: toRegistryDefinition(value.definition),
		schemaSha256: value.schemaSha256,
	};
}

export function toRegistryBinding(value: RegistryBinding): AgentPluginBinding {
	return {
		id: value.id,
		entryId: value.entryId,
		instanceId: value.instanceId,
		generation: value.generation,
		configurationRevision: value.configurationRevision,
		schemaSha256: value.schemaSha256,
	};
}

export function toRegistryPage(value: RegistryPage): AgentPluginDirectoryPage {
	return { revision: value.revision, entries: value.entries.map(toRegistryEntry), nextCursor: value.nextCursor };
}
