import { readAgentId, agentRecord } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginDataSnapshot,
	readAgentPluginDataMigration,
	readAgentPluginDataMigrationResult,
} from '@nexus-terminal/shared/agent/plugins/migration-http-codec';
import {
	readAgentPluginDataKey,
	readAgentPluginDataWrite,
	readAgentPluginDataDelete,
	readAgentPluginDataView,
	readAgentPluginDataPurge,
	readAgentPluginDataPurgeView,
} from '@nexus-terminal/shared/agent/plugins/http-codec';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	AGENT_PLUGIN_MAX_MIGRATION_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import type {
	PluginDataSnapshot,
	PluginDataMigrationResult,
	PluginMigrationIntent,
	PluginDataIntent,
	PluginDataValue,
	PluginDataPurge,
} from '../model/plugin-types';
import {
	fromPluginDataSnapshot,
	fromPluginDataMigration,
	fromPluginData,
	fromPluginDataPurge,
} from '../model/plugin-mapper';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

function path(appId: string, key?: string): string {
	try {
		const root = '/plugins/installations/' + encodeURIComponent(readAgentId(appId));
		return key === undefined ? root : root + '/data/' + encodeURIComponent(readAgentPluginDataKey(key));
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

export async function getPluginDataSnapshot(appId: string, signal?: AbortSignal): Promise<PluginDataSnapshot> {
	const value = await requestAgentManagement({
		method: 'GET',
		path: path(appId) + '/data-snapshot',
		maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_MIGRATION_BYTES,
		signal,

		decode: (value) => readAgentPluginDataSnapshot(value, appId),
	});
	return fromPluginDataSnapshot(value);
}

export function decodePluginMigration(value: unknown): PluginMigrationIntent {
	const input = readAgentPluginDataMigration(value);
	return {
		operationId: input.operationId,
		expectedRevision: input.expectedRevision,
		items: input.items.map((item) => ({
			key: item.key,
			expectedVersion: item.expectedVersion,
			valueJson: item.valueJson,
		})),
	};
}

export async function migratePluginData(
	appId: string,
	intent: PluginMigrationIntent,
	signal?: AbortSignal,
): Promise<PluginDataMigrationResult> {
	const request = () =>
		readAgentPluginDataMigration({
			expectedRevision: intent.expectedRevision,
			operationId: intent.operationId,
			items: intent.items.map((item) => ({
				key: item.key,
				expectedVersion: item.expectedVersion,
				valueJson: item.valueJson,
			})),
		});

	const value = await requestAgentManagement({
		method: 'POST',
		path: path(appId) + '/migrate-data',
		maxRequestBytes: AGENT_PLUGIN_MAX_MIGRATION_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES,
		signal,

		input: request,

		decode: (value) => readAgentPluginDataMigrationResult(value, appId, request()),
	});
	return fromPluginDataMigration(value);
}

export async function getPluginData(appId: string, key: string, signal?: AbortSignal): Promise<PluginDataValue | null> {
	const value = await requestAgentManagement({
		method: 'GET',
		path: path(appId, key),
		maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES,
		signal,

		decode(value) {
			const row = agentRecord(value, ['value'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
			const item = row.value === null ? null : readAgentPluginDataView(row.value);
			if (item !== null && item.key !== key) {
				throw new Error('Plugin data key mismatch');
			}
			return item;
		},
	});
	return value === null ? null : fromPluginData(value);
}

export async function mutatePluginData(
	appId: string,
	intent: PluginDataIntent,
	signal?: AbortSignal,
): Promise<PluginDataValue> {
	const value = await requestAgentManagement({
		method: intent.valueJson === null ? 'DELETE' : 'PUT',
		path: path(appId, intent.key),
		maxRequestBytes: AGENT_PLUGIN_MAX_MESSAGE_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES,
		signal,

		input: () =>
			intent.valueJson === null
				? readAgentPluginDataDelete({
						expectedRevision: intent.expectedRevision,
						expectedVersion: intent.expectedVersion,
						operationId: intent.operationId,
					})
				: readAgentPluginDataWrite({
						expectedRevision: intent.expectedRevision,
						expectedVersion: intent.expectedVersion,
						operationId: intent.operationId,
						valueJson: intent.valueJson,
					}),

		decode(value) {
			const item = readAgentPluginDataView(value);
			if (
				item.key !== intent.key ||
				item.version !== intent.expectedVersion + 1 ||
				item.valueJson !== intent.valueJson
			) {
				throw new Error('Plugin data confirmation mismatch');
			}
			return item;
		},
	});
	return fromPluginData(value);
}

export async function purgePluginData(
	appId: string,
	revision: number,
	operationId: string,
	signal?: AbortSignal,
): Promise<PluginDataPurge> {
	const value = await requestAgentManagement({
		method: 'POST',
		path: path(appId) + '/delete-data',
		maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES,
		signal,

		input: () => readAgentPluginDataPurge({ expectedRevision: revision, operationId }),

		decode(value) {
			const result = readAgentPluginDataPurgeView(value);
			if (result.revision !== revision + 1) {
				throw new Error('Plugin data purge confirmation mismatch');
			}
			return result;
		},
	});
	return fromPluginDataPurge(value);
}
