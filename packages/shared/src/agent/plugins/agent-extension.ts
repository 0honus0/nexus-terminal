export interface AgentPluginPackageDependency {
	packageId: string;
	publisherKeyId: string;
	minVersion: string;
	maxVersion: string;
}

/** Signed entry points and capability bounds; handlers and business schemas register at activation. */
export interface AgentPluginContribution {
	app: { entry: string; uiContract: string | null; uiApiVersion: number | null } | null;
	tools: boolean;
	services: boolean;
	ui: { contract: string; apiVersion: number } | null;
	settings: import('./settings.js').AgentPluginSettingsContribution | null;
	skills: { id: string; path: string }[];
}
