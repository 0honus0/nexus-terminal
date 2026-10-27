import type { AgentPluginData } from './model.js';

export interface AgentPluginDataSnapshot {
	appId: string;
	revision: number;
	items: AgentPluginData[];
}

export interface AgentPluginDataMigrationResult {
	appId: string;
	operationId: string;
	revision: number;
	changedKeys: number;
	updatedAt: number;
}
