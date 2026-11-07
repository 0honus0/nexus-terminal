import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { pluginManifest } from '../package/plugin-manifest.js';
import { PluginStorageRefusal } from '../../storage/plugin-storage.js';

/** Preserve monotonic revisions and original intent identities while removing configuration and secrets. */
export async function clearPluginInstanceSettings(
	tx: SqlExecutor,
	userId: number,
	scope: { kind: 'app'; appId: string } | { kind: 'package'; packageId: string },
	now: number,
): Promise<void> {
	const appId = scope.kind === 'app' ? scope.appId : null;
	const packageId = scope.kind === 'package' ? scope.packageId : null;
	const instances = await tx.all(
		`SELECT i.*,v.manifest_json,c.revision AS connector_revision FROM agent_plugin_instances i
	 LEFT JOIN agent_plugin_packages p ON p.user_id=i.user_id AND p.package_id=i.package_id
	 LEFT JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version
	 AND v.package_hash=p.package_hash AND v.publisher_key_id=p.publisher_key_id
	 LEFT JOIN agent_plugin_connections c ON c.instance_id=i.id
	 WHERE i.user_id=? AND (? IS NULL OR i.app_id=?) AND (? IS NULL OR i.package_id=?)`,
		[userId, appId, appId, packageId, packageId],
	);
	for (const instance of instances) {
		if (
			typeof instance.id !== 'string' ||
			typeof instance.app_id !== 'string' ||
			(instance.manifest_json !== null && typeof instance.manifest_json !== 'string') ||
			typeof instance.configuration_revision !== 'number' ||
			typeof instance.revision !== 'number' ||
			(instance.connector_revision !== null && typeof instance.connector_revision !== 'number')
		) {
			throw new Error('Invalid plugin instance during data cleanup');
		}
		if (
			instance.configuration_revision >= Number.MAX_SAFE_INTEGER ||
			instance.revision >= Number.MAX_SAFE_INTEGER ||
			(instance.connector_revision !== null && instance.connector_revision >= Number.MAX_SAFE_INTEGER)
		) {
			throw new PluginStorageRefusal('version_conflict');
		}
		// Retired or unavailable package code is never loaded just to erase its retained data.
		const raw: unknown = instance.manifest_json === null ? null : JSON.parse(instance.manifest_json);
		const manifest =
			raw !== null && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === 4
				? pluginManifest(raw)
				: null;
		await tx.run(
			`UPDATE agent_plugin_instances SET configuration_json=?,schema_revision=?,
		 configuration_revision=configuration_revision+1,revision=revision+1,updated_at=? WHERE id=? AND user_id=?`,
			[
				manifest?.contributions.settings?.defaultsJson ?? '{}',
				manifest?.contributions.settings?.schemaRevision ?? 0,
				now,
				instance.id,
				userId,
			],
		);
		// A tombstone prevents a cached connector revision from matching a newly-created connection.
		await tx.run(
			`UPDATE agent_plugin_connections SET connector_json='{"kind":"none"}',encrypted_credential=NULL,
		 revision=revision+1,updated_at=? WHERE instance_id=? AND user_id=?`,
			[now, instance.id, userId],
		);
		await tx.run(
			`UPDATE agent_plugin_configuration_mutations SET result_json='{}',retired=1
		 WHERE instance_id=? AND user_id=?`,
			[instance.id, userId],
		);
	}
}

export async function appsWithPluginInstanceSettings(tx: SqlExecutor, userId: number): Promise<string[]> {
	const rows = await tx.all(
		`SELECT DISTINCT i.app_id FROM agent_plugin_instances i
	 LEFT JOIN agent_plugin_packages p ON p.user_id=i.user_id AND p.package_id=i.package_id
	 LEFT JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version
	 AND v.package_hash=p.package_hash AND v.publisher_key_id=p.publisher_key_id
	 LEFT JOIN agent_plugin_connections c ON c.instance_id=i.id
	 WHERE i.user_id=? AND (i.configuration_json<>COALESCE(json_extract(v.manifest_json,'$.contributions.settings.defaultsJson'),'{}')
	 OR (c.instance_id IS NOT NULL AND (c.connector_json<>'{"kind":"none"}' OR c.encrypted_credential IS NOT NULL)))`,
		[userId],
	);
	return rows.map((row) => {
		if (typeof row.app_id !== 'string') {
			throw new Error('Invalid retained plugin settings owner');
		}
		return row.app_id;
	});
}
