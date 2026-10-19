import type { AgentIntegrationKind } from '@nexus-terminal/shared/agent/integrations/values';

export type IntegrationConfiguration =
	| { kind: 'mcp'; name: string; endpoint: string; privateHosts: string[] }
	| { kind: 'acp'; name: string; connectionId: number; argv: string[]; cwd: string };

export interface ManagedIntegration {
	id: string;
	appId: string;
	configuration: IntegrationConfiguration;
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	schemaHash: string | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface IntegrationDraft {
	kind: AgentIntegrationKind;
	name: string;
	endpoint: string;
	privateHostsText: string;
	connectionId: number;
	argvJson: string;
	cwd: string;
	enabled: boolean;
	credentialAction: 'keep' | 'clear' | 'replace';
	credential: string;
}

export interface IntegrationDiscovery {
	integration: ManagedIntegration;
	serverName: string;
	serverVersion: string;
	protocolVersion: string;
	tools: { name: string; description: string; inputSchemaJson: string }[];
	resources: { uri: string; name: string }[];
	prompts: { name: string; description: string }[];
}
