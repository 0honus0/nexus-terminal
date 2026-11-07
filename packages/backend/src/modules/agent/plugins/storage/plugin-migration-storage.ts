export interface StoredPluginDataSnapshot {
	appId: string;
	revision: number;
	items: { packageId: string; key: string; version: number; valueJson: string | null; updatedAt: number }[];
}

export interface StoredPluginDataMigration {
	expectedRevision: number;
	operationId: string;
	requestHash: string;
	now: number;
	items: { packageId: string; key: string; expectedVersion: number; valueJson: string | null }[];
}

export interface StoredPluginDataMigrationResult {
	appId: string;
	operationId: string;
	revision: number;
	changedKeys: number;
	updatedAt: number;
}
