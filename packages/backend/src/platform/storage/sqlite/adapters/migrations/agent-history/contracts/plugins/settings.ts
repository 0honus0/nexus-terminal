// Frozen published database migration dependency. Not an application API.
/** Signed static settings remain readable when a backend instance cannot activate. */
export interface AgentPluginSettingsContribution {
	frontendEntry: string | null;
	instructions: string;
	schemaRevision: number;
	schemaJson: string;
	defaultsJson: string;
	agentEditablePaths: string[];
}
