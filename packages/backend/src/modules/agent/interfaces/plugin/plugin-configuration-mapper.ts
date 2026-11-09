import type {
	AgentPluginConfigurationView,
	AgentPluginInstanceSettings,
	AgentPluginInstanceView,
} from '@nexus-terminal/shared/agent/plugins/settings';
import type {
	PluginConfiguration,
	PluginInstance,
	PluginInstanceSource,
} from '../../plugins/model/plugin-instance-types.js';

export function toPluginInstance(value: PluginInstance): AgentPluginInstanceView {
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

export function toPluginConfiguration(value: PluginConfiguration): AgentPluginConfigurationView {
	return {
		instanceId: value.instanceId,
		packageId: value.packageId,
		revision: value.revision,
		schemaRevision: value.schemaRevision,
		documentJson: value.documentJson,
	};
}

export function toPluginInstanceSettings(value: PluginInstanceSource): AgentPluginInstanceSettings {
	const settings = value.manifest.contributions.settings;
	return {
		instance: toPluginInstance(value.instance),
		packageRevision: value.packageRevision,
		configuration: toPluginConfiguration(value.configuration),
		connectionKinds:
			value.manifest.contributions.app !== null &&
			!value.manifest.contributions.services &&
			!value.manifest.contributions.tools
				? []
				: [
						...(value.manifest.capabilities.includes('service.transport.http') ? ['http' as const] : []),
						...(value.manifest.capabilities.includes('service.transport.process')
							? ['remoteProcess' as const]
							: []),
					],
		settings:
			settings === null
				? null
				: {
						frontendEntry: settings.frontendEntry,
						instructions: settings.instructions,
						schemaRevision: settings.schemaRevision,
						schemaJson: settings.schemaJson,
						defaultsJson: settings.defaultsJson,
						agentEditablePaths: settings.agentEditablePaths.map((path) => path),
					},
	};
}
