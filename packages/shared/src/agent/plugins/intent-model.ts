export interface AgentPluginIntentReceipt {
	id: string;
	senderAppId: string;
	receiverAppId: string;
	senderVersion: string;
	receiverVersion: string;
	senderRevision: string;
	receiverRevision: string;
	intentId: string;
	schemaVersion: number;
	inputJson: string;
	artifactIds: string[];
	createdAt: number;
	expiresAt: number;
	revokedAt: number | null;
}
