import type {
	AgentPluginPublisher,
	AgentPluginManifest,
	AgentPluginStage,
	AgentPluginInstallation,
	AgentPluginVersion,
	AgentPluginData,
	AgentPluginDataPurge,
} from '@nexus-terminal/shared/agent/plugins/model';
import type {
	AgentPluginCatalog,
	AgentPluginCatalogEntry,
	AgentPluginRecommended,
	AgentPluginRepositorySettings,
} from '@nexus-terminal/shared/agent/plugins/repository-model';
import type {
	AgentPluginDataSnapshot,
	AgentPluginDataMigrationResult,
} from '@nexus-terminal/shared/agent/plugins/migration-model';
import type {
	PluginPublisher,
	PluginManifest,
	PluginStage,
	PluginInstallation,
	PluginVersion,
	PluginCatalog,
	PluginCatalogEntry,
	PluginRecommendation,
	PluginRepositories,
	PluginDataValue,
	PluginDataSnapshot,
	PluginDataPurge,
	PluginDataMigrationResult,
} from './plugin-types';

export function fromPluginPublisher(value: AgentPluginPublisher): PluginPublisher {
	return {
		keyId: value.keyId,
		publicKeyPem: value.publicKeyPem,
		label: value.label,
		version: value.version,
		createdAt: value.createdAt,
		revokedAt: value.revokedAt,
	};
}

export function fromPluginManifest(value: AgentPluginManifest): PluginManifest {
	return {
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		sdkVersion: value.sdkVersion,
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
	};
}

export function fromPluginStage(value: AgentPluginStage): PluginStage {
	return {
		id: value.id,
		packageHash: value.packageHash,
		sizeBytes: value.sizeBytes,
		status: value.status,
		version: value.version,
		publisherKeyId: value.publisherKeyId,
		manifest: value.manifest === null ? null : fromPluginManifest(value.manifest),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromPluginInstallation(value: AgentPluginInstallation): PluginInstallation {
	return {
		appId: value.appId,
		definitionId: value.definitionId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
		status: value.status,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromPluginVersion(value: AgentPluginVersion): PluginVersion {
	return {
		manifest: fromPluginManifest(value.manifest),
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function fromPluginRepositories(value: AgentPluginRepositorySettings): PluginRepositories {
	return { version: value.version, urls: value.repositories.map((item) => item.url), updatedAt: value.updatedAt };
}

export function fromPluginCatalogEntry(value: AgentPluginCatalogEntry): PluginCatalogEntry {
	return {
		definitionId: value.appId,
		version: value.version,
		sdkVersion: value.sdkVersion,
		minVersion: value.nexus.minVersion,
		maxVersion: value.nexus.maxVersion,
		displayName: value.displayName,
		description: value.description,
		packageUrl: value.packageUrl,
		sha256: value.sha256,
		sizeBytes: value.sizeBytes,
		publisherKeyId: value.publisherKeyId,
		compatible: value.compatible,
	};
}

export function fromPluginCatalog(value: AgentPluginCatalog): PluginCatalog {
	return {
		repositoryUrl: value.repositoryUrl,
		publishers: value.publishers.map((item) => ({
			keyId: item.keyId,
			label: item.label,
			publicKeyPem: item.publicKeyPem,
		})),
		packages: value.packages.map(fromPluginCatalogEntry),
	};
}

export function fromPluginRecommendation(value: AgentPluginRecommended): PluginRecommendation {
	return {
		entry: value.entry === null ? null : fromPluginCatalogEntry(value.entry),
		installation: value.installation === null ? null : fromPluginInstallation(value.installation),
	};
}

export function fromPluginData(value: AgentPluginData): PluginDataValue {
	return { key: value.key, version: value.version, valueJson: value.valueJson, updatedAt: value.updatedAt };
}

export function fromPluginDataSnapshot(value: AgentPluginDataSnapshot): PluginDataSnapshot {
	return { appId: value.appId, revision: value.revision, items: value.items.map(fromPluginData) };
}

export function fromPluginDataPurge(value: AgentPluginDataPurge): PluginDataPurge {
	return { revision: value.revision, deletedKeys: value.deletedKeys, updatedAt: value.updatedAt };
}

export function fromPluginDataMigration(value: AgentPluginDataMigrationResult): PluginDataMigrationResult {
	return {
		appId: value.appId,
		operationId: value.operationId,
		revision: value.revision,
		changedKeys: value.changedKeys,
		updatedAt: value.updatedAt,
	};
}
