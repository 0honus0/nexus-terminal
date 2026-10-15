import type { AgentPluginIntentReceipt } from './intent-model.js';

export interface AgentPluginIntentCreateRequest {
	operationId: string;
	receiverAppId: string;
	intentId: string;
	inputJson: string;
	artifactIds: string[];
	confirmed: true;
}

export interface AgentPluginIntentResponse {
	receipt: AgentPluginIntentReceipt;
}

export interface AgentPluginIntentListResponse {
	items: AgentPluginIntentReceipt[];
}

export interface AgentPluginIntentRevokeResponse {
	revoked: true;
}
