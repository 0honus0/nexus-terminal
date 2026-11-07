import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Every execution reference must still be the exact package fixed by the scope declaration. */
export async function pluginTrust(tx: SqlReader, userId: number, appId: string, version: string): Promise<boolean> {
	const row = await tx.one(
		`SELECT i.revision FROM agent_plugin_installations i
		 JOIN agent_apps a ON a.user_id=i.user_id AND a.id=i.app_id
		 JOIN agent_app_definition_packages main ON main.user_id=a.user_id AND main.definition_id=a.definition_id AND main.definition_version=a.definition_version AND main.kind='app'
		 WHERE i.user_id=? AND i.app_id=? AND i.version=? AND i.status='installed'
		 AND main.package_id=i.definition_id AND main.version=i.version AND main.package_hash=i.package_hash AND main.publisher_key_id=i.publisher_key_id
		 AND NOT EXISTS (
		  SELECT 1 FROM agent_app_definition_packages expected
		  LEFT JOIN agent_plugin_app_packages ref ON ref.user_id=expected.user_id AND ref.app_id=a.id AND ref.package_id=expected.package_id AND ref.kind=expected.kind
		  LEFT JOIN agent_plugin_packages p ON p.user_id=expected.user_id AND p.package_id=expected.package_id
		  LEFT JOIN agent_plugin_publishers k ON k.user_id=expected.user_id AND k.key_id=expected.publisher_key_id
		  WHERE expected.user_id=a.user_id AND expected.definition_id=a.definition_id AND expected.definition_version=a.definition_version
		  AND (ref.package_id IS NULL OR ref.version<>expected.version OR ref.package_hash<>expected.package_hash OR ref.publisher_key_id<>expected.publisher_key_id
		   OR p.package_id IS NULL OR p.status NOT IN ('installed','draining') OR p.version<>expected.version OR p.package_hash<>expected.package_hash OR p.publisher_key_id<>expected.publisher_key_id
		   OR k.key_id IS NULL OR k.revoked_at IS NOT NULL)
		 )
		 AND NOT EXISTS (
		  SELECT 1 FROM agent_plugin_app_packages ref
		  WHERE ref.user_id=a.user_id AND ref.app_id=a.id AND ref.kind IN ('app','tool')
		  AND NOT EXISTS (SELECT 1 FROM agent_app_definition_packages expected WHERE expected.user_id=a.user_id AND expected.definition_id=a.definition_id AND expected.definition_version=a.definition_version AND expected.package_id=ref.package_id AND expected.kind=ref.kind)
		 )`,
		[userId, appId, version],
	);
	return row !== null;
}
