import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	StoredPluginDataMigration,
	StoredPluginDataMigrationResult,
	StoredPluginDataSnapshot,
} from '../../storage/plugin-migration-storage.js';
import { PluginStorageRefusal } from '../../storage/plugin-storage.js';
import { pluginDataRow, readPluginData } from './plugin-data-sql.js';
import { readPluginExtensionData } from './plugin-extension-data-sql.js';

function itemIdentity(item: { packageId: string; key: string }): string {
	return item.packageId + '\0' + item.key;
}

async function mainPackage(tx: SqlExecutor, userId: number, appId: string): Promise<string> {
	const row = await tx.one('SELECT definition_id FROM agent_plugin_installations WHERE user_id=? AND app_id=?', [
		userId,
		appId,
	]);
	if (typeof row?.definition_id !== 'string') {
		throw new PluginStorageRefusal('not_found');
	}
	return row.definition_id;
}

export async function readPluginDataSnapshot(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	namespace?: string,
): Promise<StoredPluginDataSnapshot['items']> {
	const packageId = await mainPackage(tx, userId, appId);
	if (namespace && namespace !== packageId) {
		const known = await tx.one(
			'SELECT 1 FROM agent_plugin_app_packages WHERE user_id=? AND app_id=? AND package_id=? UNION ALL SELECT 1 FROM agent_plugin_extension_data WHERE user_id=? AND app_id=? AND package_id=? LIMIT 1',
			[userId, appId, namespace, userId, appId, namespace],
		);
		if (!known) {
			throw new PluginStorageRefusal('not_found');
		}
	}
	const rows = namespace
		? namespace === packageId
			? await tx.all(
					'SELECT ? AS package_id,key,version,value_json,updated_at FROM agent_plugin_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL ORDER BY key',
					[namespace, userId, appId],
				)
			: await tx.all(
					'SELECT package_id,key,version,value_json,updated_at FROM agent_plugin_extension_data WHERE user_id=? AND app_id=? AND package_id=? AND value_json IS NOT NULL ORDER BY key',
					[userId, appId, namespace],
				)
		: await tx.all(
				'SELECT ? AS package_id,key,version,value_json,updated_at FROM agent_plugin_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL UNION ALL SELECT package_id,key,version,value_json,updated_at FROM agent_plugin_extension_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL ORDER BY package_id,key',
				[packageId, userId, appId, userId, appId],
			);
	return rows.map((row) => {
		if (typeof row.package_id !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(row.package_id)) {
			throw new Error('Corrupt migration namespace');
		}
		const item = pluginDataRow(row);
		return {
			packageId: row.package_id,
			key: item.key,
			version: item.version,
			valueJson: item.valueJson,
			updatedAt: item.updatedAt,
		};
	});
}

export async function migratePluginData(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	input: StoredPluginDataMigration,
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
	const packageId = await mainPackage(tx, userId, appId);
	const namespaces = await tx.all(
		'SELECT package_id FROM agent_plugin_app_packages WHERE user_id=? AND app_id=? UNION SELECT package_id FROM agent_plugin_extension_data WHERE user_id=? AND app_id=?',
		[userId, appId, userId, appId],
	);
	const allowed = new Set(namespaces.map((row) => row.package_id));
	allowed.add(packageId);
	if (input.items.some((item) => !allowed.has(item.packageId))) {
		throw new PluginStorageRefusal('version_conflict');
	}
	const current: StoredPluginDataSnapshot['items'] = input.items.length
		? []
		: await readPluginDataSnapshot(tx, userId, appId);
	for (const namespace of new Set(input.items.map((item) => item.packageId))) {
		current.push(...(await readPluginDataSnapshot(tx, userId, appId, namespace)));
	}
	const source = new Map(current.map((item) => [itemIdentity(item), item]));
	for (const item of input.items) {
		if (!source.has(itemIdentity(item))) {
			const stored =
				item.packageId === packageId
					? await readPluginData(tx, userId, appId, item.key)
					: await readPluginExtensionData(tx, userId, appId, item.packageId, item.key);
			if (stored !== null) {
				source.set(itemIdentity(item), {
					packageId: item.packageId,
					key: stored.key,
					version: stored.version,
					valueJson: stored.valueJson,
					updatedAt: stored.updatedAt,
				});
			}
		}
	}
	const destination = new Map(input.items.map((item) => [itemIdentity(item), item]));
	if (
		destination.size !== input.items.length ||
		current.some((item) => !destination.has(itemIdentity(item))) ||
		input.items.some((item) => (source.get(itemIdentity(item))?.version ?? 0) !== item.expectedVersion)
	) {
		throw new PluginStorageRefusal('version_conflict');
	}

	const binding = await tx.one(
		'SELECT execution_revision,ui_revision FROM agent_plugin_app_bindings WHERE user_id=? AND app_id=?',
		[userId, appId],
	);
	if (
		input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
		!binding ||
		typeof binding.execution_revision !== 'number' ||
		typeof binding.ui_revision !== 'number' ||
		binding.execution_revision >= Number.MAX_SAFE_INTEGER ||
		binding.ui_revision >= Number.MAX_SAFE_INTEGER
	) {
		throw new PluginStorageRefusal('version_conflict');
	}
	let changedKeys = 0;
	for (const item of input.items) {
		const old = source.get(itemIdentity(item));
		if (old && old.valueJson === item.valueJson) {
			continue;
		}
		if (old?.version === Number.MAX_SAFE_INTEGER) {
			throw new PluginStorageRefusal('version_conflict');
		}
		if (item.packageId === packageId) {
			await tx.run(
				'INSERT INTO agent_plugin_data(user_id,app_id,key,version,value_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,app_id,key) DO UPDATE SET version=excluded.version,value_json=excluded.value_json,updated_at=excluded.updated_at',
				[userId, appId, item.key, (old?.version ?? 0) + 1, item.valueJson, input.now],
			);
			await tx.run(
				'UPDATE agent_plugin_data_operations SET retired=1,value_json=NULL WHERE user_id=? AND app_id=? AND key=? AND retired=0',
				[userId, appId, item.key],
			);
		} else {
			await tx.run(
				'INSERT INTO agent_plugin_extension_data(user_id,app_id,package_id,key,version,value_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,app_id,package_id,key) DO UPDATE SET version=excluded.version,value_json=excluded.value_json,updated_at=excluded.updated_at',
				[userId, appId, item.packageId, item.key, (old?.version ?? 0) + 1, item.valueJson, input.now],
			);
			await tx.run(
				'UPDATE agent_plugin_extension_operations SET retired=1,value_json=NULL WHERE user_id=? AND app_id=? AND package_id=? AND key=? AND retired=0',
				[userId, appId, item.packageId, item.key],
			);
		}
		await tx.run(
			'UPDATE agent_plugin_package_updates SET data_migrated=1 WHERE user_id=? AND package_id=? AND EXISTS(SELECT 1 FROM agent_plugin_app_packages ref WHERE ref.user_id=agent_plugin_package_updates.user_id AND ref.package_id=agent_plugin_package_updates.package_id AND ref.app_id=?)',
			[userId, item.packageId, appId],
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
	await tx.run(
		'UPDATE agent_plugin_app_bindings SET execution_revision=execution_revision+1,ui_revision=ui_revision+1 WHERE user_id=? AND app_id=?',
		[userId, appId],
	);
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
