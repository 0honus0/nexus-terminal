// Frozen published database migration dependency. Not an application API.
import { pluginContractText } from './registry-codec.js';

import { AGENT_PLUGIN_MAX_PACKAGE_ID_BYTES, AGENT_PLUGIN_MAX_VERSION_BYTES } from './package-values.js';

import { compare } from 'semver';

import type { AgentPluginContribution } from './agent-extension.js';

import { isAgentRecord, agentRecord, agentText, agentInteger, InvalidAgentPayload } from '../http-codec.js';

import { AGENT_CAPABILITIES } from '../governance/values.js';

import {
	AGENT_PLUGIN_MAX_MANIFEST_BYTES,
	AGENT_PLUGIN_MAX_ENTRY_BYTES,
	AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
	isAgentPluginVersion,
} from './values.js';

import type { AgentPluginManifest, AgentPluginCompatibility } from './model.js';

function keyId(input: unknown): string {
	const value = agentText(input, 72);
	if (!/^ed25519:[a-f0-9]{64}$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function version(input: unknown): string {
	const value = agentText(input, AGENT_PLUGIN_MAX_VERSION_BYTES);
	if (!isAgentPluginVersion(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function entry(input: unknown, prefix: string): string | null {
	if (input === null) {
		return null;
	}
	const value = agentText(input, AGENT_PLUGIN_MAX_ENTRY_BYTES);
	if (
		!value.startsWith(prefix + '/') ||
		value.split('/').some((part) => part.startsWith('.') || !/^[A-Za-z0-9_.-]{1,255}$/u.test(part))
	) {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentPluginPackageId(input: unknown): string {
	const value = agentText(input, AGENT_PLUGIN_MAX_PACKAGE_ID_BYTES);
	if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentPluginCompatibility(input: unknown): AgentPluginCompatibility {
	const row = agentRecord(input, ['host', 'backendSdk', 'frontendSdk']);
	const host = agentRecord(row.host, ['minVersion', 'maxVersion']);
	const minVersion = version(host.minVersion),
		maxVersion = version(host.maxVersion);
	if (compare(minVersion, maxVersion) > 0) {
		throw new InvalidAgentPayload();
	}
	return {
		host: { minVersion, maxVersion },
		backendSdk: row.backendSdk === null ? null : agentInteger(row.backendSdk, 1),
		frontendSdk: row.frontendSdk === null ? null : agentInteger(row.frontendSdk, 1),
	};
}

export function readAgentPluginContribution(input: unknown): AgentPluginContribution {
	const row = agentRecord(
		input,
		['app', 'tools', 'services', 'ui', 'settings', 'skills'],
		AGENT_PLUGIN_MAX_MANIFEST_BYTES,
	);
	if (typeof row.tools !== 'boolean' || typeof row.services !== 'boolean' || !Array.isArray(row.skills)) {
		throw new InvalidAgentPayload();
	}
	let app: AgentPluginContribution['app'] = null;
	if (row.app !== null) {
		const value = agentRecord(row.app, ['entry', 'uiContract', 'uiApiVersion']);
		if ((value.uiContract === null) !== (value.uiApiVersion === null)) {
			throw new InvalidAgentPayload();
		}
		app = {
			entry: agentText(value.entry, AGENT_PLUGIN_MAX_ENTRY_BYTES),
			uiContract: value.uiContract === null ? null : pluginContractText(value.uiContract),
			uiApiVersion: value.uiApiVersion === null ? null : agentInteger(value.uiApiVersion, 1),
		};
	}
	let ui: AgentPluginContribution['ui'] = null;
	if (row.ui !== null) {
		const value = agentRecord(row.ui, ['contract', 'apiVersion']);
		ui = { contract: pluginContractText(value.contract), apiVersion: agentInteger(value.apiVersion, 1) };
	}
	let settings: AgentPluginContribution['settings'] = null;
	if (row.settings !== null) {
		const value = agentRecord(
			row.settings,
			['frontendEntry', 'instructions', 'schemaRevision', 'schemaJson', 'defaultsJson', 'agentEditablePaths'],
			AGENT_PLUGIN_MAX_MANIFEST_BYTES,
		);
		if (
			typeof value.schemaJson !== 'string' ||
			typeof value.defaultsJson !== 'string' ||
			typeof value.instructions !== 'string' ||
			!Array.isArray(value.agentEditablePaths)
		) {
			throw new InvalidAgentPayload();
		}
		let parsedSchema: unknown;
		try {
			parsedSchema = JSON.parse(value.schemaJson);
			JSON.parse(value.defaultsJson);
		} catch {
			throw new InvalidAgentPayload();
		}
		if (!isAgentRecord(parsedSchema)) {
			throw new InvalidAgentPayload();
		}
		const paths = value.agentEditablePaths.map((path) => {
			if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/u.test(path)) {
				throw new InvalidAgentPayload();
			}
			return path;
		});
		if (new Set(paths).size !== paths.length) {
			throw new InvalidAgentPayload();
		}
		settings = {
			frontendEntry: entry(value.frontendEntry, 'frontend'),
			instructions: value.instructions,
			schemaRevision: agentInteger(value.schemaRevision, 1),
			schemaJson: value.schemaJson,
			defaultsJson: value.defaultsJson,
			agentEditablePaths: paths,
		};
	}
	const skills = row.skills.map((item) => {
		const value = agentRecord(item, ['id', 'path']);
		const path = entry(value.path, 'skills');
		if (
			path === null ||
			!/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u.test(path) ||
			typeof value.id !== 'string' ||
			value.id.includes('\0')
		) {
			throw new InvalidAgentPayload();
		}
		return { id: value.id, path };
	});
	if (
		new Set(skills.map((skill) => skill.id)).size !== skills.length ||
		(app === null && !row.tools && !row.services && ui === null && settings === null && skills.length === 0)
	) {
		throw new InvalidAgentPayload();
	}
	return { app, tools: row.tools, services: row.services, ui, settings, skills };
}

export function readAgentPluginManifest(input: unknown): AgentPluginManifest {
	const row = agentRecord(
		input,
		[
			'schemaVersion',
			'id',
			'version',
			'displayName',
			...(input !== null && typeof input === 'object' && 'requiredOnEnable' in input ? ['requiredOnEnable'] : []),
			'compatibility',
			'capabilities',
			'intents',
			'frontendEntry',
			'backendEntry',
			'contributions',
			'dependencies',
			'namespaces',
		],
		AGENT_PLUGIN_MAX_MANIFEST_BYTES,
	);
	if (
		row.schemaVersion !== AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION ||
		!Array.isArray(row.capabilities) ||
		!Array.isArray(row.intents) ||
		!Array.isArray(row.dependencies) ||
		!Array.isArray(row.namespaces)
	) {
		throw new InvalidAgentPayload();
	}
	if (row.requiredOnEnable !== undefined && typeof row.requiredOnEnable !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	const id = readAgentPluginPackageId(row.id);
	const capabilities = row.capabilities.map((value) => {
		const capability = AGENT_CAPABILITIES.find((item) => item === value);
		if (!capability) {
			throw new InvalidAgentPayload();
		}
		return capability;
	});
	const intents = row.intents.map((value) => {
		const item = agentRecord(value, ['id', 'schemaVersion']);
		return { id: agentText(item.id, 128), schemaVersion: agentInteger(item.schemaVersion, 1) };
	});
	const compatibility = readAgentPluginCompatibility(row.compatibility);
	const frontendEntry = entry(row.frontendEntry, 'frontend'),
		backendEntry = entry(row.backendEntry, 'backend');
	const contributions = readAgentPluginContribution(row.contributions);
	const dependencies = row.dependencies.map((item) => {
		const value = agentRecord(item, ['packageId', 'publisherKeyId', 'minVersion', 'maxVersion']);
		const minVersion = version(value.minVersion),
			maxVersion = version(value.maxVersion);
		if (compare(minVersion, maxVersion) > 0) {
			throw new InvalidAgentPayload();
		}
		return {
			packageId: readAgentPluginPackageId(value.packageId),
			publisherKeyId: keyId(value.publisherKeyId),
			minVersion,
			maxVersion,
		};
	});
	const namespaces = row.namespaces.map(pluginContractText);
	if (
		new Set(capabilities).size !== capabilities.length ||
		new Set(intents.map((item) => item.id)).size !== intents.length ||
		new Set(dependencies.map((item) => item.packageId)).size !== dependencies.length ||
		dependencies.some((dependency) => dependency.packageId === id) ||
		new Set(namespaces).size !== namespaces.length ||
		namespaces.some((namespace) => !/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u.test(namespace)) ||
		(backendEntry === null) !== (compatibility.backendSdk === null) ||
		(frontendEntry !== null || contributions.settings?.frontendEntry != null) !==
			(compatibility.frontendSdk !== null) ||
		(contributions.ui !== null) !== (frontendEntry !== null) ||
		((contributions.app !== null || contributions.tools || contributions.services) &&
			(backendEntry === null || compatibility.backendSdk !== 4 || namespaces.length === 0)) ||
		contributions.skills.some((skill) => skill.id !== id + '.' + skill.path.split('/')[1])
	) {
		throw new InvalidAgentPayload();
	}
	return {
		schemaVersion: AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
		id,
		version: version(row.version),
		displayName: agentText(row.displayName, 128),
		requiredOnEnable: row.requiredOnEnable,
		compatibility,
		capabilities,
		intents,
		frontendEntry,
		backendEntry,
		contributions,
		dependencies,
		namespaces,
	};
}
