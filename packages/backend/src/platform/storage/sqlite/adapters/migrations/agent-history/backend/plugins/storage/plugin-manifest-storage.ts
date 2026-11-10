// Frozen published database migration dependency. Not an application API.
export interface StoredPluginPackageDependency {
	packageId: string;
	publisherKeyId: string;
	minVersion: string;
	maxVersion: string;
}

export interface StoredPluginSignedContribution {
	app: {
		entry: string;
		uiContract: string | null;
		uiApiVersion: number | null;
	} | null;
	tools: boolean;
	services: boolean;
	ui: {
		contract: string;
		apiVersion: number;
	} | null;
	settings: {
		frontendEntry: string | null;
		instructions: string;
		schemaRevision: number;
		schemaJson: string;
		defaultsJson: string;
		agentEditablePaths: string[];
	} | null;
	skills: {
		id: string;
		path: string;
	}[];
}
