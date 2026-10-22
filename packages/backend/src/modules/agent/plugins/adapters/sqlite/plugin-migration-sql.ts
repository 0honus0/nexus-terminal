import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredPluginData } from '../../storage/plugin-storage.js';
import { PluginStorageRefusal } from '../../storage/plugin-storage.js';
import type {
	StoredPluginDataMigration,
	StoredPluginDataMigrationResult,
} from '../../storage/plugin-migration-storage.js';
import { pluginDataRow, readPluginData } from './plugin-data-sql.js';
import { AGENT_PLUGIN_MAX_MIGRATION_KEYS } from '@nexus-terminal/shared/agent/plugins/values';

export async function readPluginDataSnapshot(
	tx: SqlExecutor,
	userId: number,
	appId: string,
): Promise<StoredPluginData[]> {
	return (
		await tx.all(
			'SELECT key,version,value_json,updated_at FROM agent_plugin_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL ORDER BY key LIMIT ?',
			[userId, appId, AGENT_PLUGIN_MAX_MIGRATION_KEYS + 1],
		)
	).map(pluginDataRow);
}

export async function migratePluginData(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	input: StoredPluginDataMigration,
	admit: (keys: number, bytes: number) => void,
): Promise<StoredPluginDataMigrationResult> {
	const previous = await tx.one(
		'SELECT * FROM agent_plugin_data_migrations WHERE user_id=? AND app_id=? AND operation_id=?',
		[userId, appId, input.operationId],
	);
	if (previous) {
		if (previous.request_hash !== input.requestHash) {
			throw new PluginStorageRefusal('version_conflict');
		}
		if (
			typeof previous.result_revision !== 'number' ||
			previous.result_revision !== input.expectedRevision + 1 ||
			typeof previous.changed_keys !== 'number' ||
			!Number.isSafeInteger(previous.changed_keys) ||
			previous.changed_keys < 0 ||
			previous.changed_keys > input.items.length ||
			typeof previous.updated_at !== 'number' ||
			!Number.isSafeInteger(previous.updated_at) ||
			previous.updated_at < 0
		) {
			throw new Error('Corrupt plugin data migration');
		}
		return {
			appId,
			operationId: input.operationId,
			revision: previous.result_revision,
			changedKeys: previous.changed_keys,
			updatedAt: previous.updated_at,
		};
	}
	const current = await readPluginDataSnapshot(tx, userId, appId);
	const source = new Map(current.map((item) => [item.key, item]));
	for (const item of input.items) {
		if (!source.has(item.key)) {
			const stored = await readPluginData(tx, userId, appId, item.key);
			if (stored !== null) {
				source.set(item.key, stored);
			}
		}
	}
	const destination = new Map(input.items.map((item) => [item.key, item]));
	if (
		destination.size !== input.items.length ||
		current.some((item) => !destination.has(item.key)) ||
		input.items.some((item) => (source.get(item.key)?.version ?? 0) !== item.expectedVersion)
	) {
		throw new PluginStorageRefusal('version_conflict');
	}
	admit(
		input.items.filter((item) => item.valueJson !== null).length,
		input.items.reduce(
			(bytes, item) => bytes + (item.valueJson === null ? 0 : Buffer.byteLength(item.valueJson, 'utf8')),
			0,
		),
	);
	let changedKeys = 0;
	for (const item of input.items) {
		const old = source.get(item.key);
		if (old && old.valueJson === item.valueJson) {
			continue;
		}
		if (old?.version === Number.MAX_SAFE_INTEGER) {
			throw new PluginStorageRefusal('version_conflict');
		}
		await tx.run(
			'INSERT INTO agent_plugin_data(user_id,app_id,key,version,value_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,app_id,key) DO UPDATE SET version=excluded.version,value_json=excluded.value_json,updated_at=excluded.updated_at',
			[userId, appId, item.key, (old?.version ?? 0) + 1, item.valueJson, input.now],
		);
		await tx.run(
			'UPDATE agent_plugin_data_operations SET retired=1,value_json=NULL WHERE user_id=? AND app_id=? AND key=? AND retired=0',
			[userId, appId, item.key],
		);
		changedKeys++;
	}
	const changed = await tx.run(
		'UPDATE agent_plugin_installations SET revision=revision+1,updated_at=? WHERE user_id=? AND app_id=? AND revision=?',
		[input.now, userId, appId, input.expectedRevision],
	);
	if (changed.changes !== 1) {
		throw new PluginStorageRefusal('version_conflict');
	}
	const result = {
		appId,
		operationId: input.operationId,
		revision: input.expectedRevision + 1,
		changedKeys,
		updatedAt: input.now,
	};
	await tx.run(
		'INSERT INTO agent_plugin_data_migrations(user_id,app_id,operation_id,request_hash,result_revision,changed_keys,updated_at) VALUES(?,?,?,?,?,?,?)',
		[userId, appId, input.operationId, input.requestHash, result.revision, result.changedKeys, result.updatedAt],
	);
	return result;
}
