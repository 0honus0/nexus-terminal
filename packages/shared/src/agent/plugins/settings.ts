/** Signed static settings remain readable when a backend instance cannot activate. */
export interface AgentPluginSettingsContribution {
	frontendEntry: string | null;
	instructions: string;
	schemaRevision: number;
	schemaJson: string;
	defaultsJson: string;
	agentEditablePaths: string[];
}

export interface AgentPluginConfigurationView {
	instanceId: string;
	packageId: string;
	revision: number;
	schemaRevision: number;
	documentJson: string;
}

export interface AgentPluginConfigurationWrite {
	operationKey: string;
	expectedPackageRevision: number;
	expectedRevision: number;
	schemaRevision: number;
	documentJson: string;
}

export interface AgentPluginInstanceView {
	id: string;
	appId: string;
	packageId: string;
	name: string;
	selected: boolean;
	enabled: boolean;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentPluginInstanceCreate {
	packageId: string;
	name: string;
}

export interface AgentPluginInstanceUpdate {
	expectedRevision: number;
	name: string;
	selected: boolean;
	enabled: boolean;
}

/** The signed schema is available without starting an executable plugin. */
export interface AgentPluginInstanceSettings {
	instance: AgentPluginInstanceView;
	packageRevision: number;
	connectionKinds: ('http' | 'remoteProcess')[];
	configuration: AgentPluginConfigurationView;
	settings: AgentPluginSettingsContribution | null;
}
