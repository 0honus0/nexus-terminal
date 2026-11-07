import type {
	AgentPluginInstanceView,
	AgentPluginConfigurationView,
	AgentPluginInstanceSettings,
} from '@nexus-terminal/shared/agent/plugins/settings';
import type { PluginInstance, PluginConfiguration, PluginInstanceSettings } from './plugin-instance-types';

export function fromPluginInstance(value: AgentPluginInstanceView): PluginInstance {
	return {
		id: value.id,
		appId: value.appId,
		packageId: value.packageId,
		name: value.name,
		selected: value.selected,
		enabled: value.enabled,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromPluginConfiguration(value: AgentPluginConfigurationView): PluginConfiguration {
	return {
		instanceId: value.instanceId,
		packageId: value.packageId,
		revision: value.revision,
		schemaRevision: value.schemaRevision,
		documentJson: value.documentJson,
	};
}

export function fromPluginInstanceSettings(value: AgentPluginInstanceSettings): PluginInstanceSettings {
	return {
		instance: fromPluginInstance(value.instance),
		packageRevision: value.packageRevision,
		connectionKinds: value.connectionKinds.map((kind) => kind),
		configuration: fromPluginConfiguration(value.configuration),
		settings:
			value.settings === null
				? null
				: {
						frontendEntry: value.settings.frontendEntry,
						instructions: value.settings.instructions,
						schemaRevision: value.settings.schemaRevision,
						schemaJson: value.settings.schemaJson,
						defaultsJson: value.settings.defaultsJson,
						agentEditablePaths: value.settings.agentEditablePaths.map((path) => path),
					},
	};
}
