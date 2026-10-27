export interface AgentPluginDataMigration {
	expectedRevision: number;
	operationId: string;
	items: { key: string; expectedVersion: number; valueJson: string | null }[];
}
