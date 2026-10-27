import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredPluginData, StoredPluginDataMutation } from '../../storage/plugin-storage.js';
import { PluginStorageRefusal } from '../../storage/plugin-storage.js';
import {
	AGENT_PLUGIN_MAX_DATA_KEY_BYTES,
	AGENT_PLUGIN_MAX_DATA_VALUE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';

export function pluginDataRow(row: SqlRow): StoredPluginData {
	if (
		typeof row.key !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(row.key) ||
		Buffer.byteLength(row.key, 'utf8') > AGENT_PLUGIN_MAX_DATA_KEY_BYTES ||
		typeof row.version !== 'number' ||
		!Number.isSafeInteger(row.version) ||
		row.version < 1 ||
		typeof row.updated_at !== 'number' ||
		!Number.isSafeInteger(row.updated_at) ||
		row.updated_at < 0 ||
		(row.value_json !== null && typeof row.value_json !== 'string')
	) {
		throw new Error('Corrupt plugin data');
	}
	if (row.value_json !== null) {
		if (Buffer.byteLength(row.value_json, 'utf8') > AGENT_PLUGIN_MAX_DATA_VALUE_BYTES) {
			throw new Error('Corrupt plugin data size');
		}
		JSON.parse(row.value_json);
	}
	return { key: row.key, version: row.version, valueJson: row.value_json, updatedAt: row.updated_at };
}

export async function readPluginData(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	key: string,
): Promise<StoredPluginData | null> {
	const row = await tx.one(
		'SELECT key,version,value_json,updated_at FROM agent_plugin_data WHERE user_id=? AND app_id=? AND key=?',
		[userId, appId, key],
	);
	return row === null ? null : pluginDataRow(row);
}

export async function mutatePluginData(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	input: StoredPluginDataMutation,
	decide: (current: StoredPluginData | null, keyCount: number, dataBytes: number) => void,
): Promise<StoredPluginData> {
	const replay = await tx.one(
		'SELECT content_hash,key,version,value_json,updated_at,retired FROM agent_plugin_data_operations WHERE user_id=? AND app_id=? AND operation_id=?',
		[userId, appId, input.operationId],
	);
	if (replay) {
		if (replay.content_hash !== input.contentHash || replay.retired !== 0) {
			throw new PluginStorageRefusal('version_conflict');
		}
		return pluginDataRow(replay);
	}
	const current = await readPluginData(tx, userId, appId, input.key);
	const counts = await tx.one(
		'SELECT COUNT(*) AS keys,COALESCE(SUM(LENGTH(CAST(value_json AS BLOB))),0) AS data_bytes FROM agent_plugin_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL',
		[userId, appId],
	);
	if (typeof counts?.keys !== 'number' || typeof counts.data_bytes !== 'number') {
		throw new Error('Plugin data count missing');
	}
	decide(current, counts.keys, counts.data_bytes);
	if (current?.version === Number.MAX_SAFE_INTEGER) {
		throw new PluginStorageRefusal('version_conflict');
	}
	const version = (current?.version ?? 0) + 1;
	await tx.run(
		'UPDATE agent_plugin_data_operations SET retired=1,value_json=NULL WHERE user_id=? AND app_id=? AND key=? AND retired=0',
		[userId, appId, input.key],
	);
	await tx.run(
		'INSERT INTO agent_plugin_data VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,app_id,key) DO UPDATE SET version=excluded.version,value_json=excluded.value_json,updated_at=excluded.updated_at',
		[userId, appId, input.key, version, input.valueJson, input.now],
	);
	await tx.run(
		'INSERT INTO agent_plugin_data_operations(user_id,app_id,operation_id,content_hash,key,version,value_json,updated_at) VALUES(?,?,?,?,?,?,?,?)',
		[userId, appId, input.operationId, input.contentHash, input.key, version, input.valueJson, input.now],
	);
	return { key: input.key, version, valueJson: input.valueJson, updatedAt: input.now };
}
