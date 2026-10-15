import type { AgentPluginDataMigration } from './migration-http.js';
import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { readAgentPluginDataKey, readAgentPluginDataValue } from './http-codec.js';
import { AGENT_PLUGIN_MAX_MIGRATION_BYTES, AGENT_PLUGIN_MAX_MIGRATION_KEYS } from './values.js';
import type { AgentPluginDataSnapshot, AgentPluginDataMigrationResult } from './migration-model.js';

function items(input: unknown): unknown[] {
	if (!Array.isArray(input) || input.length > AGENT_PLUGIN_MAX_MIGRATION_KEYS) {
		throw new InvalidAgentPayload();
	}
	return input;
}

function distinctKeys(values: { key: string }[]): void {
	if (new Set(values.map((item) => item.key)).size !== values.length) {
		throw new InvalidAgentPayload();
	}
}

export function readAgentPluginDataMigration(input: unknown): AgentPluginDataMigration {
	const row = agentRecord(input, ['expectedRevision', 'operationId', 'items'], AGENT_PLUGIN_MAX_MIGRATION_BYTES);
	const values = items(row.items).map((raw) => {
		const value = agentRecord(raw, ['key', 'expectedVersion', 'valueJson'], AGENT_PLUGIN_MAX_MIGRATION_BYTES);
		return {
			key: readAgentPluginDataKey(value.key),
			expectedVersion: agentInteger(value.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1),
			valueJson: value.valueJson === null ? null : readAgentPluginDataValue(value.valueJson),
		};
	});
	distinctKeys(values);
	return {
		expectedRevision: agentInteger(row.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1),
		operationId: readAgentId(row.operationId),
		items: values,
	};
}

export function readAgentPluginDataSnapshot(input: unknown, appId: string): AgentPluginDataSnapshot {
	const row = agentRecord(input, ['appId', 'revision', 'items'], AGENT_PLUGIN_MAX_MIGRATION_BYTES);
	if (readAgentId(row.appId) !== appId) {
		throw new InvalidAgentPayload();
	}
	const values = items(row.items).map((raw) => {
		const value = agentRecord(raw, ['key', 'version', 'valueJson', 'updatedAt'], AGENT_PLUGIN_MAX_MIGRATION_BYTES);
		return {
			key: readAgentPluginDataKey(value.key),
			version: agentInteger(value.version, 1),
			valueJson: value.valueJson === null ? null : readAgentPluginDataValue(value.valueJson),
			updatedAt: agentInteger(value.updatedAt),
		};
	});
	distinctKeys(values);
	return { appId, revision: agentInteger(row.revision, 1), items: values };
}

export function readAgentPluginDataMigrationResult(
	input: unknown,
	appId: string,
	request: AgentPluginDataMigration,
): AgentPluginDataMigrationResult {
	const row = agentRecord(input, ['appId', 'operationId', 'revision', 'changedKeys', 'updatedAt']);
	if (
		readAgentId(row.appId) !== appId ||
		readAgentId(row.operationId) !== request.operationId ||
		row.revision !== request.expectedRevision + 1
	) {
		throw new InvalidAgentPayload();
	}
	return {
		appId,
		operationId: request.operationId,
		revision: request.expectedRevision + 1,
		changedKeys: agentInteger(row.changedKeys, 0, request.items.length),
		updatedAt: agentInteger(row.updatedAt),
	};
}
