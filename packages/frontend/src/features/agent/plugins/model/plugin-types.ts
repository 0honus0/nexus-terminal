import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	AgentPluginInstallationStatus,
	AgentPluginStageStatus,
	AgentPluginContributionKind,
	AgentPluginCompatibilityReason,
} from '@nexus-terminal/shared/agent/plugins/values';

export interface PluginPublisher {
	keyId: string;
	publicKeyPem: string;
	label: string;
	version: number;
	createdAt: number;
	revokedAt: number | null;
}

export interface PluginManifest {
	id: string;
	version: string;
	displayName: string;
	compatibility: PluginCompatibility;
	appContribution: {
		entry: string;
		uiContract: string | null;
		uiApiVersion: number | null;
	} | null;
	dependencies: { packageId: string; publisherKeyId: string; minVersion: string; maxVersion: string }[];
	settings: {
		frontendEntry: string | null;
		instructions: string;
		schemaRevision: number;
		schemaJson: string;
		defaultsJson: string;
		agentEditablePaths: string[];
	} | null;
	contributionKinds: AgentPluginContributionKind[];
	capabilities: AgentCapability[];
	intents: { id: string; schemaVersion: number }[];
	frontendEntry: string | null;
	backendEntry: string | null;
}

export interface PluginStage {
	id: string;
	packageHash: string;
	sizeBytes: number;
	status: AgentPluginStageStatus;
	version: number;
	publisherKeyId: string | null;
	manifest: PluginManifest | null;
	createdAt: number;
	updatedAt: number;
}

export interface PluginInstallation {
	appId: string;
	definitionId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
	status: AgentPluginInstallationStatus;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface PluginInstallationDirectory {
	installations: PluginInstallation[];
	retainedAppIds: string[];
}

export interface PluginVersion {
	manifest: PluginManifest;
	packageHash: string;
	publisherKeyId: string;
}

export interface PluginRepositories {
	version: number;
	urls: string[];
	updatedAt: number;
}

export interface PluginCatalogEntry {
	definitionId: string;
	version: string;
	compatibility: PluginCompatibility;
	contributionKinds: AgentPluginContributionKind[];
	compatibilityReason: AgentPluginCompatibilityReason | null;
	displayName: string;
	description: string;
	localizations?: { locale: string; displayName: string; description: string }[];
	packageUrl: string;
	sha256: string;
	sizeBytes: number;
	publisherKeyId: string;
	compatible: boolean;
}

export interface PluginCatalog {
	repositoryUrl: string;
	publishers: { keyId: string; label: string; publicKeyPem: string }[];
	packages: PluginCatalogEntry[];
}

export interface PluginRecommendation {
	entry: PluginCatalogEntry | null;
	installation: PluginInstallation | null;
}

export interface PluginDataPurge {
	revision: number;
	deletedKeys: number;
	updatedAt: number;
}

export interface PluginCompatibility {
	host: { minVersion: string; maxVersion: string };
	backendSdk: number | null;
	frontendSdk: number | null;
}

export interface PluginPackageInstallation {
	packageId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
	status: AgentPluginInstallationStatus | 'incompatible';
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface PluginPackageReference {
	packageId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
}

export interface PluginAppBinding {
	appId: string;
	executionRevision: number;
	uiRevision: number;
	app: PluginPackageReference;
	dependencies: PluginPackageReference[];
	selectedRootIds: string[];
	ui: PluginPackageReference | null;
}

export interface PluginPackageDirectory {
	installations: PluginPackageInstallation[];
	retainedPackageIds: string[];
}

export interface PluginPackageUpdatePreparation {
	installation: PluginPackageInstallation;
	dependencies: { package: PluginPackageReference; installationRevision: number }[];
}
