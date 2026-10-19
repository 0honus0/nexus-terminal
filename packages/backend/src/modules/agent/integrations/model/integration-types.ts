export type IntegrationConfiguration =
	| {
			kind: 'mcp';
			displayName: string;
			endpoint: string;
			privateHostExceptions: string[];
			protocolVersion: '2026-07-28';
	  }
	| { kind: 'acp'; displayName: string; connectionId: number; argv: string[]; cwd: string; protocolVersion: '1' };

export interface IntegrationActor {
	userId: number;
	appId: string;
	token: string;
}

export type IntegrationCredential = { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export interface IntegrationInput {
	configuration: IntegrationConfiguration;
	enabled: boolean;
	credential: IntegrationCredential;
}

export interface IntegrationRecord {
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

export interface IntegrationFacts {
	exists: boolean;
	enabled: boolean;
	identityUserId: number | null;
	count: number;
}

export interface IntegrationDiscovery {
	serverName: string;
	serverVersion: string;
	protocolVersion: string;
	tools: { name: string; description: string; inputSchemaJson: string }[];
	resources: { uri: string; name: string }[];
	prompts: { name: string; description: string }[];
}

export interface IntegrationInvocation {
	id: string;
	version: number;
	schemaHash: string;
	kind: 'tool' | 'resource' | 'prompt';
	name: string;
	argumentsJson: string;
	resume: { requestState: string | null; inputResponsesJson: string } | null;
}

export type IntegrationReply =
	| { kind: 'complete'; resultJson: string }
	| { kind: 'input_required'; requestState: string | null; inputRequestsJson: string };

export interface IntegrationPendingInput {
	userId: number;
	appId: string;
	runId: string;
	id: string;
	version: number;
	schemaHash: string;
	kind: 'tool' | 'resource' | 'prompt';
	name: string;
	argumentsJson: string;
	requestState: string;
	remoteRequestState: string | null;
	expiresAt: number;
}

export interface AcpIntegrationInvocation {
	id: string;
	version: number;
	prompt: string;
}

export type IntegrationCatalogInput = { id: null; version: null } | { id: string; version: number };
