export interface AgentPluginDataSnapshot {
	appId: string;
	revision: number;
	items: { packageId: string; key: string; version: number; valueJson: string | null; updatedAt: number }[];
}

export interface AgentPluginDataMigrationResult {
	appId: string;
	operationId: string;
	revision: number;
	changedKeys: number;
	updatedAt: number;
}
