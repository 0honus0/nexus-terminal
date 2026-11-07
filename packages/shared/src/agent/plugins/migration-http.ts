export interface AgentPluginDataMigration {
	expectedRevision: number;
	operationId: string;
	items: { packageId: string; key: string; expectedVersion: number; valueJson: string | null }[];
}
