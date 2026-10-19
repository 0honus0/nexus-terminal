import type { StoredPluginData } from './plugin-storage.js';

export interface StoredPluginDataSnapshot {
	appId: string;
	revision: number;
	items: StoredPluginData[];
}

export interface StoredPluginDataMigration {
	expectedRevision: number;
	operationId: string;
	requestHash: string;
	now: number;
	items: { key: string; expectedVersion: number; valueJson: string | null }[];
}

export interface StoredPluginDataMigrationResult {
	appId: string;
	operationId: string;
	revision: number;
	changedKeys: number;
	updatedAt: number;
}
