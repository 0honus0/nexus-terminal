import type { AgentPluginDataMigration } from '@nexus-terminal/shared/agent/plugins/migration-http';
import { toPluginData } from './plugin-mapper.js';
import type {
	AgentPluginDataSnapshot,
	AgentPluginDataMigrationResult,
} from '@nexus-terminal/shared/agent/plugins/migration-model';
import type {
	PluginDataMigration,
	PluginDataSnapshot,
	PluginDataMigrationResult,
} from '../../plugins/model/plugin-migration-types.js';

export function fromPluginDataMigration(value: AgentPluginDataMigration): PluginDataMigration {
	return {
		expectedRevision: value.expectedRevision,
		operationId: value.operationId,
		items: value.items.map((item) => ({
			key: item.key,
			expectedVersion: item.expectedVersion,
			valueJson: item.valueJson,
		})),
	};
}

export function toPluginDataSnapshot(value: PluginDataSnapshot): AgentPluginDataSnapshot {
	return { appId: value.appId, revision: value.revision, items: value.items.map(toPluginData) };
}

export function toPluginDataMigrationResult(value: PluginDataMigrationResult): AgentPluginDataMigrationResult {
	return {
		appId: value.appId,
		operationId: value.operationId,
		revision: value.revision,
		changedKeys: value.changedKeys,
		updatedAt: value.updatedAt,
	};
}
