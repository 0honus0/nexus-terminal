export interface PluginInstance {
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

export interface PluginConfiguration {
	instanceId: string;
	packageId: string;
	revision: number;
	schemaRevision: number;
	documentJson: string;
}

export interface PluginInstanceSettings {
	instance: PluginInstance;
	packageRevision: number;
	connectionKinds: ('http' | 'remoteProcess')[];
	configuration: PluginConfiguration;
	settings: {
		frontendEntry: string | null;
		instructions: string;
		schemaRevision: number;
		schemaJson: string;
		defaultsJson: string;
		agentEditablePaths: string[];
	} | null;
}

export interface PluginConfigurationWrite {
	operationKey: string;
	expectedPackageRevision: number;
	expectedRevision: number;
	schemaRevision: number;
	documentJson: string;
}

export interface PluginInstanceUpdate {
	expectedRevision: number;
	name: string;
	selected: boolean;
	enabled: boolean;
}
