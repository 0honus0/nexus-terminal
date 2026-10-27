export type AgentIntegrationConfiguration =
	| {
			kind: 'mcp';
			displayName: string;
			endpoint: string;
			privateHostExceptions: string[];
			protocolVersion: '2026-07-28';
	  }
	| { kind: 'acp'; displayName: string; connectionId: number; argv: string[]; cwd: string; protocolVersion: '1' };

export interface AgentIntegrationView {
	id: string;
	appId: string;
	configuration: AgentIntegrationConfiguration;
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	schemaHash: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentIntegrationDiscovery {
	integration: AgentIntegrationView;
	serverName: string;
	serverVersion: string;
	protocolVersion: string;
	tools: { name: string; description: string; inputSchemaJson: string }[];
	resources: { uri: string; name: string }[];
	prompts: { name: string; description: string }[];
}
