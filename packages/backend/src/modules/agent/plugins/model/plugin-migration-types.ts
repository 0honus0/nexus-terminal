import type { PluginData } from './plugin-types.js';

export interface PluginDataSnapshot {
	appId: string;
	revision: number;
	items: PluginData[];
}

export interface PluginDataMigration {
	expectedRevision: number;
	operationId: string;
	items: { key: string; expectedVersion: number; valueJson: string | null }[];
}

export interface PluginDataMigrationResult {
	appId: string;
	operationId: string;
	revision: number;
	changedKeys: number;
	updatedAt: number;
}
