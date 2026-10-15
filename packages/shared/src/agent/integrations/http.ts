import type { AgentIntegrationConfiguration, AgentIntegrationView } from './model.js';

export type AgentIntegrationCredential =
	{ action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export interface AgentIntegrationCreateRequest {
	configuration: AgentIntegrationConfiguration;
	enabled: boolean;
	credential: AgentIntegrationCredential;
}

export interface AgentIntegrationUpdateRequest {
	expectedVersion: number;
	configuration: AgentIntegrationConfiguration;
	enabled: boolean;
	credential: AgentIntegrationCredential;
}

export interface AgentIntegrationVersionRequest {
	expectedVersion: number;
}

export interface AgentIntegrationListResponse {
	items: AgentIntegrationView[];
}
