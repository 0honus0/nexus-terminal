import type { PluginManifest } from './plugin-types.js';
import type { StoredPluginManifest } from '../storage/plugin-storage.js';
import { AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import type { PluginSignedContribution } from './plugin-manifest-types.js';
import type { StoredPluginSignedContribution } from '../storage/plugin-manifest-storage.js';

export function fromStoredPluginContribution(value: StoredPluginSignedContribution): PluginSignedContribution {
	return {
		app:
			value.app === null
				? null
				: { entry: value.app.entry, uiContract: value.app.uiContract, uiApiVersion: value.app.uiApiVersion },
		tools: value.tools,
		services: value.services,
		ui: value.ui === null ? null : { contract: value.ui.contract, apiVersion: value.ui.apiVersion },
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
		skills: value.skills.map((skill) => ({ id: skill.id, path: skill.path })),
	};
}

export function toStoredPluginContribution(value: PluginSignedContribution): StoredPluginSignedContribution {
	return {
		app:
			value.app === null
				? null
				: { entry: value.app.entry, uiContract: value.app.uiContract, uiApiVersion: value.app.uiApiVersion },
		tools: value.tools,
		services: value.services,
		ui: value.ui === null ? null : { contract: value.ui.contract, apiVersion: value.ui.apiVersion },
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
		skills: value.skills.map((skill) => ({ id: skill.id, path: skill.path })),
	};
}

export function fromStoredPluginManifest(value: StoredPluginManifest): PluginManifest {
	return {
		schemaVersion: AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		requiredOnEnable: value.requiredOnEnable,
		compatibility: {
			host: { minVersion: value.compatibility.host.minVersion, maxVersion: value.compatibility.host.maxVersion },
			backendSdk: value.compatibility.backendSdk,
			frontendSdk: value.compatibility.frontendSdk,
		},
		dependencies: value.dependencies.map((item) => ({
			packageId: item.packageId,
			publisherKeyId: item.publisherKeyId,
			minVersion: item.minVersion,
			maxVersion: item.maxVersion,
		})),
		contributions: fromStoredPluginContribution(value.contributions),
		namespaces: value.namespaces.map((namespace) => namespace),
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
	};
}

export function toStoredPluginManifest(value: PluginManifest): StoredPluginManifest {
	return {
		schemaVersion: AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		requiredOnEnable: value.requiredOnEnable,
		compatibility: {
			host: { minVersion: value.compatibility.host.minVersion, maxVersion: value.compatibility.host.maxVersion },
			backendSdk: value.compatibility.backendSdk,
			frontendSdk: value.compatibility.frontendSdk,
		},
		dependencies: value.dependencies.map((item) => ({
			packageId: item.packageId,
			publisherKeyId: item.publisherKeyId,
			minVersion: item.minVersion,
			maxVersion: item.maxVersion,
		})),
		contributions: toStoredPluginContribution(value.contributions),
		namespaces: value.namespaces.map((namespace) => namespace),
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
	};
}
