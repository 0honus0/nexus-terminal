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
