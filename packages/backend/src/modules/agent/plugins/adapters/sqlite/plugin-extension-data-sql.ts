import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { pluginDataRow } from './plugin-data-sql.js';
import type { StoredPluginData, StoredPluginDataMutation } from '../../storage/plugin-storage.js';
import { PluginStorageRefusal } from '../../storage/plugin-storage.js';

export async function readPluginExtensionData(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	packageId: string,
	key: string,
): Promise<StoredPluginData | null> {
	const row = await tx.one(
		'SELECT * FROM agent_plugin_extension_data WHERE user_id=? AND app_id=? AND package_id=? AND key=?',
		[userId, appId, packageId, key],
	);
	return row ? pluginDataRow(row) : null;
}

export async function mutatePluginExtensionData(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	packageId: string,
	input: StoredPluginDataMutation,
	decide: (current: StoredPluginData | null) => void,
): Promise<StoredPluginData> {
	const replay = await tx.one(
		'SELECT * FROM agent_plugin_extension_operations WHERE user_id=? AND app_id=? AND package_id=? AND operation_id=?',
		[userId, appId, packageId, input.operationId],
	);
	if (replay) {
		if (replay.content_hash !== input.contentHash || replay.retired !== 0) {
			throw new PluginStorageRefusal('version_conflict');
		}
		return pluginDataRow(replay);
	}
	const current = await readPluginExtensionData(tx, userId, appId, packageId, input.key);
	decide(current);
	if (current?.version === Number.MAX_SAFE_INTEGER) {
		throw new PluginStorageRefusal('version_conflict');
	}
	const version = (current?.version ?? 0) + 1;
	await tx.run(
		'UPDATE agent_plugin_extension_operations SET retired=1,value_json=NULL WHERE user_id=? AND app_id=? AND package_id=? AND key=? AND retired=0',
		[userId, appId, packageId, input.key],
	);
	await tx.run(
		'INSERT INTO agent_plugin_extension_data VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,app_id,package_id,key) DO UPDATE SET version=excluded.version,value_json=excluded.value_json,updated_at=excluded.updated_at',
		[userId, appId, packageId, input.key, version, input.valueJson, input.now],
	);
	await tx.run(
		'INSERT INTO agent_plugin_extension_operations(user_id,app_id,package_id,operation_id,content_hash,key,version,value_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
		[
			userId,
			appId,
			packageId,
			input.operationId,
			input.contentHash,
			input.key,
			version,
			input.valueJson,
			input.now,
		],
	);
	return { key: input.key, version, valueJson: input.valueJson, updatedAt: input.now };
}
