import type { AgentPluginIntentReceipt } from '@nexus-terminal/shared/agent/plugins/intent-model';
import type { AgentPluginIntentCreateRequest } from '@nexus-terminal/shared/agent/plugins/intent-http';
import type { PluginIntentCreate, PluginIntentReceipt } from '../../plugins/model/plugin-intent-types.js';

export function toPluginIntentInput(value: AgentPluginIntentCreateRequest): PluginIntentCreate {
	return {
		operationId: value.operationId,
		receiverAppId: value.receiverAppId,
		intentId: value.intentId,
		inputJson: value.inputJson,
		artifactIds: value.artifactIds.map((item) => item),
		confirmed: true,
	};
}

export function toPluginIntent(value: PluginIntentReceipt): AgentPluginIntentReceipt {
	return {
		id: value.id,
		senderAppId: value.senderAppId,
		receiverAppId: value.receiverAppId,
		senderVersion: value.senderVersion,
		receiverVersion: value.receiverVersion,
		senderRevision: value.senderRevision,
		receiverRevision: value.receiverRevision,
		intentId: value.intentId,
		schemaVersion: value.schemaVersion,
		inputJson: value.inputJson,
		artifactIds: value.artifactIds.map((item) => item),
		createdAt: value.createdAt,
		expiresAt: value.expiresAt,
		revokedAt: value.revokedAt,
	};
}
