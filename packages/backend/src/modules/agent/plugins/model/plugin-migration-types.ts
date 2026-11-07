export interface PluginDataSnapshot {
	appId: string;
	revision: number;
	items: { packageId: string; key: string; version: number; valueJson: string | null; updatedAt: number }[];
}

export interface PluginDataMigration {
	expectedRevision: number;
	operationId: string;
	items: { packageId: string; key: string; expectedVersion: number; valueJson: string | null }[];
}

export interface PluginDataMigrationResult {
	appId: string;
	operationId: string;
	revision: number;
	changedKeys: number;
	updatedAt: number;
}
