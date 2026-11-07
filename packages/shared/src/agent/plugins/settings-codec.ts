import {
	agentInteger,
	agentRecord,
	encodeAgentJson,
	isAgentRecord,
	InvalidAgentPayload,
	readAgentId,
} from '../http-codec.js';
import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES, AGENT_PLUGIN_MAX_MESSAGE_BYTES } from './values.js';
import { readAgentPluginPackageEntry } from './package-entry-codec.js';
import { readAgentPluginPackageId } from './http-codec.js';
import type {
	AgentPluginConfigurationView,
	AgentPluginConfigurationWrite,
	AgentPluginSettingsContribution,
	AgentPluginInstanceView,
	AgentPluginInstanceCreate,
	AgentPluginInstanceUpdate,
	AgentPluginInstanceSettings,
} from './settings.js';

function documentJson(input: unknown): string {
	if (typeof input !== 'string') {
		throw new InvalidAgentPayload();
	}
	try {
		const value: unknown = JSON.parse(input);
		if (!isAgentRecord(value)) {
			throw new InvalidAgentPayload();
		}
		return encodeAgentJson(value, AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	} catch {
		throw new InvalidAgentPayload();
	}
}

/** RFC 6901 paths name complete subtrees; an empty path grants the complete business document. */
export function readAgentPluginConfigurationPath(input: unknown): string {
	if (typeof input !== 'string' || (input !== '' && !input.startsWith('/')) || /~(?:[^01]|$)/u.test(input)) {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentPluginSettingsContribution(input: unknown): AgentPluginSettingsContribution {
	const row = agentRecord(
		input,
		['frontendEntry', 'instructions', 'schemaRevision', 'schemaJson', 'defaultsJson', 'agentEditablePaths'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const frontendEntry = readAgentPluginPackageEntry(row.frontendEntry, 'frontend');
	const instructions = readAgentPluginPackageEntry(row.instructions, 'docs');
	if (instructions === null || !Array.isArray(row.agentEditablePaths)) {
		throw new InvalidAgentPayload();
	}
	const agentEditablePaths = row.agentEditablePaths.map(readAgentPluginConfigurationPath);
	if (new Set(agentEditablePaths).size !== agentEditablePaths.length) {
		throw new InvalidAgentPayload();
	}
	return {
		frontendEntry,
		instructions,
		schemaRevision: agentInteger(row.schemaRevision, 1),
		schemaJson: documentJson(row.schemaJson),
		defaultsJson: documentJson(row.defaultsJson),
		agentEditablePaths,
	};
}

export function readAgentPluginConfigurationView(input: unknown): AgentPluginConfigurationView {
	const row = agentRecord(
		input,
		['instanceId', 'packageId', 'revision', 'schemaRevision', 'documentJson'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	return {
		instanceId: readAgentId(row.instanceId),
		packageId: readAgentPluginPackageId(row.packageId),
		revision: agentInteger(row.revision),
		schemaRevision: agentInteger(row.schemaRevision),
		documentJson: documentJson(row.documentJson),
	};
}

function name(input: unknown): string {
	if (typeof input !== 'string' || !input.trim()) {
		throw new InvalidAgentPayload();
	}
	return input;
}

function flag(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentPluginInstanceView(input: unknown): AgentPluginInstanceView {
	const row = agentRecord(
		input,
		['id', 'appId', 'packageId', 'name', 'selected', 'enabled', 'revision', 'createdAt', 'updatedAt'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const createdAt = agentInteger(row.createdAt);
	const updatedAt = agentInteger(row.updatedAt, createdAt);
	return {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		packageId: readAgentPluginPackageId(row.packageId),
		name: name(row.name),
		selected: flag(row.selected),
		enabled: flag(row.enabled),
		revision: agentInteger(row.revision, 1),
		createdAt,
		updatedAt,
	};
}

export function readAgentPluginInstanceCreate(input: unknown): AgentPluginInstanceCreate {
	const row = agentRecord(input, ['packageId', 'name'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
	return { packageId: readAgentPluginPackageId(row.packageId), name: name(row.name) };
}

export function readAgentPluginInstanceUpdate(input: unknown): AgentPluginInstanceUpdate {
	const row = agentRecord(
		input,
		['expectedRevision', 'name', 'selected', 'enabled'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	return {
		expectedRevision: agentInteger(row.expectedRevision, 1),
		name: name(row.name),
		selected: flag(row.selected),
		enabled: flag(row.enabled),
	};
}

export function readAgentPluginInstanceSettings(input: unknown): AgentPluginInstanceSettings {
	const row = agentRecord(
		input,
		['instance', 'packageRevision', 'configuration', 'settings', 'connectionKinds'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	if (!Array.isArray(row.connectionKinds)) {
		throw new InvalidAgentPayload();
	}
	const connectionKinds = row.connectionKinds.map((kind) => {
		if (kind !== 'http' && kind !== 'remoteProcess') {
			throw new InvalidAgentPayload();
		}
		return kind;
	});
	if (new Set(connectionKinds).size !== connectionKinds.length) {
		throw new InvalidAgentPayload();
	}
	const instance = readAgentPluginInstanceView(row.instance);
	const configuration = readAgentPluginConfigurationView(row.configuration);
	const settings = row.settings === null ? null : readAgentPluginSettingsContribution(row.settings);
	if (instance.id !== configuration.instanceId || instance.packageId !== configuration.packageId) {
		throw new InvalidAgentPayload();
	}
	return {
		instance,
		packageRevision: agentInteger(row.packageRevision, 1),
		connectionKinds,
		configuration,
		settings,
	};
}

export function readAgentPluginConfigurationWrite(input: unknown): AgentPluginConfigurationWrite {
	const row = agentRecord(
		input,
		['operationKey', 'expectedPackageRevision', 'expectedRevision', 'schemaRevision', 'documentJson'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	return {
		operationKey: readAgentId(row.operationKey),
		expectedPackageRevision: agentInteger(row.expectedPackageRevision, 1),
		expectedRevision: agentInteger(row.expectedRevision),
		schemaRevision: agentInteger(row.schemaRevision, 1),
		documentJson: documentJson(row.documentJson),
	};
}
