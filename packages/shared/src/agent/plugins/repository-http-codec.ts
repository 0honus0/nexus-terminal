import { AGENT_PLUGIN_MAX_VERSION_BYTES, AGENT_PLUGIN_PACKAGE_HASH_LENGTH } from './package-values.js';
import { isAgentPluginVersion } from './values.js';
import { readAgentPluginInstallation, readAgentPluginCompatibility, readAgentPluginPackageId } from './http-codec.js';
import type { AgentPluginRecommended } from './repository-model.js';
import { agentRecord, agentText, agentInteger, InvalidAgentPayload } from '../http-codec.js';
import type {
	AgentPluginRepositoryUpdate,
	AgentPluginRepositoryStage,
	AgentPluginOfficialStage,
} from './repository-http.js';
import type {
	AgentPluginRepositorySettings,
	AgentPluginCatalog,
	AgentPluginCatalogEntry,
	AgentPluginCatalogPackage,
	AgentPluginCatalogIndex,
} from './repository-model.js';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	AGENT_PLUGIN_MAX_ARCHIVE_BYTES,
	AGENT_PLUGIN_MAX_CATALOG_BYTES,
	AGENT_PLUGIN_CONTRIBUTION_KINDS,
	AGENT_PLUGIN_COMPATIBILITY_REASONS,
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
	if (!Array.isArray(input)) {
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
	const row = agentRecord(input, ['version', 'repositories', 'updatedAt'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	return {
		version: agentInteger(row.version, 0),
		repositories: repositories(row.repositories),
		updatedAt: agentInteger(row.updatedAt, 0),
	};
}

function version(input: unknown): string {
	const value = agentText(input, AGENT_PLUGIN_MAX_VERSION_BYTES);
	if (!isAgentPluginVersion(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function catalogPublisherKeyId(input: unknown): string {
	const value = agentText(input, 128);
	if (!/^ed25519:[a-f0-9]{64}$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentPluginOfficialStage(input: unknown): AgentPluginOfficialStage {
	const row = agentRecord(input, ['packageId', 'publisherKeyId', 'version']);
	return {
		packageId: readAgentPluginPackageId(row.packageId),
		publisherKeyId: catalogPublisherKeyId(row.publisherKeyId),
		version: version(row.version),
	};
}

export function readAgentPluginRepositoryStage(input: unknown): AgentPluginRepositoryStage {
	const row = agentRecord(input, ['repositoryUrl', 'packageId', 'publisherKeyId', 'version']);
	return {
		repositoryUrl: readAgentPluginRepositoryUrl(row.repositoryUrl),
		packageId: readAgentPluginPackageId(row.packageId),
		publisherKeyId: catalogPublisherKeyId(row.publisherKeyId),
		version: version(row.version),
	};
}

function catalogText(input: unknown, maxBytes: number): string {
	const value = agentText(input, maxBytes);
	if (/[\u0000-\u001f\u007f]/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function catalogPublicKey(input: unknown): string {
	const value = agentText(input, 8192);
	if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value.replaceAll('\r\n', '\n');
}

function catalogPackageUrl(input: unknown, source: string | undefined): string {
	const value = catalogText(input, 4096);
	let resolved: string;
	try {
		resolved = new URL(value, source ?? 'https://catalog.invalid/').href;
	} catch {
		throw new InvalidAgentPayload();
	}
	readAgentPluginRepositoryUrl(resolved);
	return source === undefined ? value : resolved;
}

const catalogPackageKeys = [
	'packageId',
	'version',
	'compatibility',
	'contributionKinds',
	'displayName',
	'description',
	'packageUrl',
	'sha256',
	'sizeBytes',
	'publisherKeyId',
];

function catalogPackage(row: Record<string, unknown>, source?: string): AgentPluginCatalogPackage {
	const compatibility = readAgentPluginCompatibility(row.compatibility);
	if (!Array.isArray(row.contributionKinds) || row.contributionKinds.length === 0) {
		throw new InvalidAgentPayload();
	}
	const contributionKinds = row.contributionKinds.map((value) => {
		const kind = AGENT_PLUGIN_CONTRIBUTION_KINDS.find((item) => item === value);
		if (!kind) {
			throw new InvalidAgentPayload();
		}
		return kind;
	});
	const sha256 = agentText(row.sha256, AGENT_PLUGIN_PACKAGE_HASH_LENGTH),
		publisherKeyId = agentText(row.publisherKeyId, 128);
	if (
		!/^[a-f0-9]{64}$/u.test(sha256) ||
		!/^ed25519:[a-f0-9]{64}$/u.test(publisherKeyId) ||
		new Set(contributionKinds).size !== contributionKinds.length
	) {
		throw new InvalidAgentPayload();
	}
	return {
		packageId: readAgentPluginPackageId(row.packageId),
		version: version(row.version),
		compatibility,
		contributionKinds,
		displayName: catalogText(row.displayName, 256),
		description: catalogText(row.description, 2048),
		packageUrl: catalogPackageUrl(row.packageUrl, source),
		sha256,
		sizeBytes: agentInteger(row.sizeBytes, 1, AGENT_PLUGIN_MAX_ARCHIVE_BYTES),
		publisherKeyId,
	};
}

export function readAgentPluginCatalogPackage(input: unknown): AgentPluginCatalogPackage {
	return catalogPackage(agentRecord(input, catalogPackageKeys, AGENT_PLUGIN_MAX_CATALOG_BYTES));
}

export function readAgentPluginCatalogEntry(input: unknown): AgentPluginCatalogEntry {
	const row = agentRecord(
		input,
		[...catalogPackageKeys, 'compatible', 'compatibilityReason'],
		AGENT_PLUGIN_MAX_CATALOG_BYTES,
	);
	const value = catalogPackage(row);
	readAgentPluginRepositoryUrl(value.packageUrl);
	const compatibilityReason =
		row.compatibilityReason === null
			? null
			: AGENT_PLUGIN_COMPATIBILITY_REASONS.find((item) => item === row.compatibilityReason);
	if (compatibilityReason === undefined || row.compatible !== (compatibilityReason === null)) {
		throw new InvalidAgentPayload();
	}
	return {
		packageId: value.packageId,
		version: value.version,
		compatibility: {
			host: { minVersion: value.compatibility.host.minVersion, maxVersion: value.compatibility.host.maxVersion },
			backendSdk: value.compatibility.backendSdk,
			frontendSdk: value.compatibility.frontendSdk,
		},
		contributionKinds: value.contributionKinds.map((kind) => kind),
		displayName: value.displayName,
		description: value.description,
		packageUrl: value.packageUrl,
		sha256: value.sha256,
		sizeBytes: value.sizeBytes,
		publisherKeyId: value.publisherKeyId,
		compatible: row.compatible,
		compatibilityReason,
	};
}

function catalogContents<T extends AgentPluginCatalogPackage>(
	row: Record<string, unknown>,
	read: (input: unknown) => T,
): { publishers: AgentPluginCatalogIndex['publishers']; packages: T[] } {
	if (row.schemaVersion !== 2 || !Array.isArray(row.publishers) || !Array.isArray(row.packages)) {
		throw new InvalidAgentPayload();
	}
	const publishers = row.publishers.map((value) => {
		const item = agentRecord(value, ['keyId', 'label', 'publicKeyPem']);
		const keyId = agentText(item.keyId, 128);
		if (!/^ed25519:[a-f0-9]{64}$/u.test(keyId)) {
			throw new InvalidAgentPayload();
		}
		return { keyId, label: catalogText(item.label, 256), publicKeyPem: catalogPublicKey(item.publicKeyPem) };
	});
	const packages = row.packages.map(read);
	const keys = new Set(publishers.map((item) => item.keyId));
	if (
		keys.size !== publishers.length ||
		new Set(packages.map((item) => item.publisherKeyId + '/' + item.packageId + '@' + item.version)).size !==
			packages.length ||
		packages.some((item) => !keys.has(item.publisherKeyId))
	) {
		throw new InvalidAgentPayload();
	}
	return { publishers, packages };
}

export function readAgentPluginCatalogIndex(input: unknown, source?: string): AgentPluginCatalogIndex {
	const row = agentRecord(input, ['schemaVersion', 'publishers', 'packages'], AGENT_PLUGIN_MAX_CATALOG_BYTES);
	const { publishers, packages } = catalogContents(row, (value) =>
		catalogPackage(agentRecord(value, catalogPackageKeys, AGENT_PLUGIN_MAX_CATALOG_BYTES), source),
	);
	return { schemaVersion: 2, publishers, packages };
}

export function readAgentPluginCatalog(input: unknown): AgentPluginCatalog {
	const row = agentRecord(
		input,
		['schemaVersion', 'repositoryUrl', 'publishers', 'packages'],
		AGENT_PLUGIN_MAX_CATALOG_BYTES,
	);
	const { publishers, packages } = catalogContents(row, readAgentPluginCatalogEntry);
	return { schemaVersion: 2, repositoryUrl: readAgentPluginRepositoryUrl(row.repositoryUrl), publishers, packages };
}

export function readAgentPluginRecommended(input: unknown): AgentPluginRecommended {
	const row = agentRecord(input, ['entry', 'installation'], AGENT_PLUGIN_MAX_CATALOG_BYTES);
	return {
		entry: row.entry === null ? null : readAgentPluginCatalogEntry(row.entry),
		installation: row.installation === null ? null : readAgentPluginInstallation(row.installation),
	};
}
