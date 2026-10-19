import { AGENT_PLUGIN_VERSION_PATTERN } from './values.js';
import { readAgentPluginInstallation } from './http-codec.js';
import type { AgentPluginRecommended } from './repository-model.js';
import { agentRecord, agentText, agentInteger, InvalidAgentPayload } from '../http-codec.js';
import type {
	AgentPluginRepositoryUpdate,
	AgentPluginRepositoryStage,
	AgentPluginOfficialStage,
} from './repository-http.js';
import type { AgentPluginRepositorySettings, AgentPluginCatalog, AgentPluginCatalogEntry } from './repository-model.js';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_ARCHIVE_BYTES,
	AGENT_PLUGIN_MAX_CATALOG_BYTES,
	AGENT_PLUGIN_MAX_REPOSITORIES,
} from './values.js';

export function readAgentPluginRepositoryUrl(input: unknown): string {
	const raw = agentText(input, 4096);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new InvalidAgentPayload();
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.hash ||
		new TextEncoder().encode(url.href).byteLength > 4096 ||
		/[\u0000-\u0020\u007f]/u.test(raw)
	) {
		throw new InvalidAgentPayload();
	}
	return url.href;
}

function repositories(input: unknown): { url: string }[] {
	if (!Array.isArray(input) || input.length > AGENT_PLUGIN_MAX_REPOSITORIES) {
		throw new InvalidAgentPayload();
	}
	const items = input.map((value) => {
		const row = agentRecord(value, ['url']);
		return { url: readAgentPluginRepositoryUrl(row.url) };
	});
	if (new Set(items.map((item) => item.url)).size !== items.length) {
		throw new InvalidAgentPayload();
	}
	return items;
}

export function readAgentPluginRepositoryUpdate(input: unknown): AgentPluginRepositoryUpdate {
	const row = agentRecord(input, ['expectedVersion', 'repositories'], AGENT_PLUGIN_MAX_BODY_BYTES);
	return {
		expectedVersion: agentInteger(row.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1),
		repositories: repositories(row.repositories),
	};
}

export function readAgentPluginRepositorySettings(input: unknown): AgentPluginRepositorySettings {
	const row = agentRecord(input, ['version', 'repositories', 'updatedAt'], AGENT_PLUGIN_MAX_BODY_BYTES);
	return {
		version: agentInteger(row.version, 0),
		repositories: repositories(row.repositories),
		updatedAt: agentInteger(row.updatedAt, 0),
	};
}

function version(input: unknown): string {
	const value = agentText(input, 64);
	if (!AGENT_PLUGIN_VERSION_PATTERN.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function appId(input: unknown): string {
	const value = agentText(input, 128);
	if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentPluginOfficialStage(input: unknown): AgentPluginOfficialStage {
	const row = agentRecord(input, ['appId', 'version']);
	return { appId: appId(row.appId), version: version(row.version) };
}

export function readAgentPluginRepositoryStage(input: unknown): AgentPluginRepositoryStage {
	const row = agentRecord(input, ['repositoryUrl', 'appId', 'version']);
	return {
		repositoryUrl: readAgentPluginRepositoryUrl(row.repositoryUrl),
		appId: appId(row.appId),
		version: version(row.version),
	};
}

export function readAgentPluginCatalogEntry(input: unknown): AgentPluginCatalogEntry {
	const row = agentRecord(
		input,
		[
			'appId',
			'version',
			'sdkVersion',
			'nexus',
			'displayName',
			'description',
			'packageUrl',
			'sha256',
			'sizeBytes',
			'publisherKeyId',
			'compatible',
		],
		AGENT_PLUGIN_MAX_CATALOG_BYTES,
	);
	const nexus = agentRecord(row.nexus, ['minVersion', 'maxVersion']);
	const sha256 = agentText(row.sha256, 64),
		publisherKeyId = agentText(row.publisherKeyId, 128);
	if (
		!/^[a-f0-9]{64}$/u.test(sha256) ||
		!/^ed25519:[a-f0-9]{64}$/u.test(publisherKeyId) ||
		typeof row.compatible !== 'boolean'
	) {
		throw new InvalidAgentPayload();
	}
	return {
		appId: appId(row.appId),
		version: version(row.version),
		sdkVersion: agentText(row.sdkVersion, 64),
		nexus: { minVersion: version(nexus.minVersion), maxVersion: version(nexus.maxVersion) },
		displayName: agentText(row.displayName, 256),
		description: agentText(row.description, 2048),
		packageUrl: readAgentPluginRepositoryUrl(row.packageUrl),
		sha256,
		sizeBytes: agentInteger(row.sizeBytes, 1, AGENT_PLUGIN_MAX_ARCHIVE_BYTES),
		publisherKeyId,
		compatible: row.compatible,
	};
}

export function readAgentPluginCatalog(input: unknown): AgentPluginCatalog {
	const row = agentRecord(
		input,
		['schemaVersion', 'repositoryUrl', 'publishers', 'packages'],
		AGENT_PLUGIN_MAX_CATALOG_BYTES,
	);
	if (
		row.schemaVersion !== 1 ||
		!Array.isArray(row.publishers) ||
		row.publishers.length > 64 ||
		!Array.isArray(row.packages) ||
		row.packages.length > 512
	) {
		throw new InvalidAgentPayload();
	}
	const publishers = row.publishers.map((value) => {
		const item = agentRecord(value, ['keyId', 'label', 'publicKeyPem']);
		const keyId = agentText(item.keyId, 128);
		if (!/^ed25519:[a-f0-9]{64}$/u.test(keyId)) {
			throw new InvalidAgentPayload();
		}
		return { keyId, label: agentText(item.label, 256), publicKeyPem: agentText(item.publicKeyPem, 8192) };
	});
	const packages = row.packages.map(readAgentPluginCatalogEntry);
	const keys = new Set(publishers.map((item) => item.keyId));
	if (
		keys.size !== publishers.length ||
		new Set(packages.map((item) => item.appId + '@' + item.version)).size !== packages.length ||
		packages.some((item) => !keys.has(item.publisherKeyId))
	) {
		throw new InvalidAgentPayload();
	}
	return { schemaVersion: 1, repositoryUrl: readAgentPluginRepositoryUrl(row.repositoryUrl), publishers, packages };
}

export function readAgentPluginRecommended(input: unknown): AgentPluginRecommended {
	const row = agentRecord(input, ['entry', 'installation'], AGENT_PLUGIN_MAX_CATALOG_BYTES);
	return {
		entry: row.entry === null ? null : readAgentPluginCatalogEntry(row.entry),
		installation: row.installation === null ? null : readAgentPluginInstallation(row.installation),
	};
}
