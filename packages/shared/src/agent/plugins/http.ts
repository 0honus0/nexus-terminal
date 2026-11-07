import type {
	AgentPluginInstallation,
	AgentPluginPackageInstallation,
	AgentPluginAppBinding,
	AgentPluginPackageUpdateDependency,
} from './model.js';

export interface AgentPluginInstallationListResponse {
	items: AgentPluginInstallation[];
	retainedAppIds: string[];
}

export interface AgentPluginPublisherRequest {
	label: string;
	publicKeyPem: string;
}

export interface AgentPluginStageRequest {
	artifactAppId: string;
	artifactId: string;
	expectedVersion: number;
}

export interface AgentPluginVersionRequest {
	expectedVersion: number;
}

export interface AgentPluginInstallRequest {
	stageId: string;
	expectedVersion: number;
}

export interface AgentPluginRetirementRequest {
	expectedRevision: number;
}

export interface AgentPluginUpgradeRequest {
	expectedRevision: number;
	stageId: string;
	expectedStageVersion: number;
}

export interface AgentPluginPackageUpdateRequest {
	expectedRevision: number;
	stageId: string;
	expectedStageVersion: number;
	dependencies: AgentPluginPackageUpdateDependency[];
}

export interface AgentPluginPackageUpdatePreparation {
	installation: AgentPluginPackageInstallation;
	dependencies: AgentPluginPackageUpdateDependency[];
}

export interface AgentPluginPackageUpdateCancellationRequest {
	expectedRevision: number;
}

export interface AgentPluginDataRequest {
	expectedRevision: number;
	expectedVersion: number;
	operationId: string;
	valueJson: string;
}

export interface AgentPluginDataDeleteRequest {
	expectedRevision: number;
	expectedVersion: number;
	operationId: string;
}

export interface AgentPluginDataPurgeRequest {
	expectedRevision: number;
	operationId: string;
}

export interface AgentPluginPackageInstallationResponse {
	installation: AgentPluginPackageInstallation;
}

export interface AgentPluginPackageInstallationListResponse {
	installations: AgentPluginPackageInstallation[];
	retainedPackageIds: string[];
}

export interface AgentPluginAppComposeRequest {
	packageId: string;
	selectedRootIds: string[];
	uiPackageId: string | null;
}

export interface AgentPluginAppCompositionUpdate {
	packageId: string;
	selectedRootIds: string[];
	uiPackageId: string | null;
	expectedExecutionRevision: number;
	expectedUiRevision: number;
}

export interface AgentPluginAppBindingResponse {
	binding: AgentPluginAppBinding;
}

export interface AgentPluginAppBindingListResponse {
	bindings: AgentPluginAppBinding[];
}

export interface AgentPluginPackageRetirementRequest {
	expectedRevision: number;
	clearData: boolean;
}
