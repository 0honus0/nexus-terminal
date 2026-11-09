import type { AgentPluginPackageUpdatePreparation } from '@nexus-terminal/shared/agent/plugins/http';
import type { AgentPluginInstallPlanStage } from '@nexus-terminal/shared/agent/plugins/install-plan';
import type { PluginPreparedStage } from './plugin-install-plan-types';
import type {
	AgentPluginPublisher,
	AgentPluginPackageInstallation,
	AgentPluginAppBinding,
	AgentPluginPackageReference,
	AgentPluginManifest,
	AgentPluginStage,
	AgentPluginInstallation,
	AgentPluginVersion,
	AgentPluginDataPurge,
} from '@nexus-terminal/shared/agent/plugins/model';
import type {
	AgentPluginCatalog,
	AgentPluginCatalogEntry,
	AgentPluginRepositorySettings,
} from '@nexus-terminal/shared/agent/plugins/repository-model';
import type {
	PluginPublisher,
	PluginPackageInstallation,
	PluginAppBinding,
	PluginPackageReference,
	PluginManifest,
	PluginStage,
	PluginInstallation,
	PluginVersion,
	PluginCatalog,
	PluginCatalogEntry,
	PluginRepositories,
	PluginDataPurge,
	PluginPackageUpdatePreparation,
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
		requiredOnEnable: value.requiredOnEnable,
		compatibility: {
			host: { minVersion: value.compatibility.host.minVersion, maxVersion: value.compatibility.host.maxVersion },
			backendSdk: value.compatibility.backendSdk,
			frontendSdk: value.compatibility.frontendSdk,
		},
		appContribution:
			value.contributions.app === null
				? null
				: {
						entry: value.contributions.app.entry,
						uiContract: value.contributions.app.uiContract,
						uiApiVersion: value.contributions.app.uiApiVersion,
					},
		dependencies: value.dependencies.map((dependency) => ({
			packageId: dependency.packageId,
			publisherKeyId: dependency.publisherKeyId,
			minVersion: dependency.minVersion,
			maxVersion: dependency.maxVersion,
		})),
		settings:
			value.contributions.settings === null
				? null
				: {
						frontendEntry: value.contributions.settings.frontendEntry,
						instructions: value.contributions.settings.instructions,
						schemaRevision: value.contributions.settings.schemaRevision,
						schemaJson: value.contributions.settings.schemaJson,
						defaultsJson: value.contributions.settings.defaultsJson,
						agentEditablePaths: value.contributions.settings.agentEditablePaths.map((path) => path),
					},
		contributionKinds: [
			...(value.contributions.app === null ? [] : ['app' as const]),
			...(value.contributions.tools ? ['tools' as const] : []),
			...(value.contributions.services ? ['services' as const] : []),
			...(value.contributions.settings ? ['settings' as const] : []),
			...(value.contributions.ui ? ['ui' as const] : []),
			...(value.contributions.skills.length ? ['skills' as const] : []),
		],
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
	};
}

export function fromPluginStage(value: AgentPluginInstallPlanStage): PluginPreparedStage;

export function fromPluginStage(value: AgentPluginStage): PluginStage;

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
		definitionId: value.packageId,
		version: value.version,
		compatibility: {
			host: { minVersion: value.compatibility.host.minVersion, maxVersion: value.compatibility.host.maxVersion },
			backendSdk: value.compatibility.backendSdk,
			frontendSdk: value.compatibility.frontendSdk,
		},
		contributionKinds: value.contributionKinds.map((kind) => kind),
		compatibilityReason: value.compatibilityReason,
		displayName: value.displayName,
		requiredOnEnable: value.requiredOnEnable,
		description: value.description,
		localizations: value.localizations?.map((item) => ({
			locale: item.locale,
			displayName: item.displayName,
			description: item.description,
		})),
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

export function fromPluginDataPurge(value: AgentPluginDataPurge): PluginDataPurge {
	return { revision: value.revision, deletedKeys: value.deletedKeys, updatedAt: value.updatedAt };
}

export function fromPluginPackageInstallation(value: AgentPluginPackageInstallation): PluginPackageInstallation {
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
		status: value.status,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function fromPluginPackageReference(value: AgentPluginPackageReference): PluginPackageReference {
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function fromPluginAppBinding(value: AgentPluginAppBinding): PluginAppBinding {
	return {
		appId: value.appId,
		executionRevision: value.executionRevision,
		uiRevision: value.uiRevision,
		app: fromPluginPackageReference(value.app),
		dependencies: value.dependencies.map(fromPluginPackageReference),
		selectedRootIds: value.selectedRootIds.map((id) => id),
		ui: value.ui === null ? null : fromPluginPackageReference(value.ui),
	};
}

export function fromPluginPackageUpdatePreparation(
	value: AgentPluginPackageUpdatePreparation,
): PluginPackageUpdatePreparation {
	return {
		installation: fromPluginPackageInstallation(value.installation),
		dependencies: value.dependencies.map((item) => ({
			package: fromPluginPackageReference(item.package),
			installationRevision: item.installationRevision,
		})),
	};
}
