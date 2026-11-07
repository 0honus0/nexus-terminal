import { AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION } from '@nexus-terminal/shared/agent/plugins/values';

import type { AgentPluginContribution } from '@nexus-terminal/shared/agent/plugins/agent-extension';
import type { StoredPluginSignedContribution } from '../../storage/plugin-manifest-storage.js';
import { readAgentPluginManifest } from '@nexus-terminal/shared/agent/plugins/http-codec';
import type { StoredPluginManifest } from '../../storage/plugin-storage.js';
import { AGENT_PLUGIN_MAX_ENTRY_BYTES } from '@nexus-terminal/shared/agent/plugins/values';

export function pluginEntry(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		Buffer.byteLength(value, 'utf8') > AGENT_PLUGIN_MAX_ENTRY_BYTES ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.split('/').some((part) => part.startsWith('.') || !/^[A-Za-z0-9_.-]{1,255}$/u.test(part))
	) {
		throw new Error('Invalid plugin entry');
	}
	return value;
}

/** Signed and persisted manifests have one current representation. */
export function pluginManifest(value: unknown): StoredPluginManifest {
	const manifest = readAgentPluginManifest(value);
	return {
		schemaVersion: AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
		id: manifest.id,
		version: manifest.version,
		displayName: manifest.displayName,
		compatibility: {
			host: {
				minVersion: manifest.compatibility.host.minVersion,
				maxVersion: manifest.compatibility.host.maxVersion,
			},
			backendSdk: manifest.compatibility.backendSdk,
			frontendSdk: manifest.compatibility.frontendSdk,
		},
		capabilities: manifest.capabilities.map((value) => value),
		intents: manifest.intents.map((value) => ({ id: value.id, schemaVersion: value.schemaVersion })),
		frontendEntry: pluginEntry(manifest.frontendEntry),
		backendEntry: pluginEntry(manifest.backendEntry),
		dependencies: manifest.dependencies.map((item) => ({
			packageId: item.packageId,
			publisherKeyId: item.publisherKeyId,
			minVersion: item.minVersion,
			maxVersion: item.maxVersion,
		})),
		contributions: toStoredContribution(manifest.contributions),
		namespaces: manifest.namespaces.map((namespace) => namespace),
	};
}

function toStoredContribution(value: AgentPluginContribution): StoredPluginSignedContribution {
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
