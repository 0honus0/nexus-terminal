import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Package draining fences new tasks while already-bound operations keep their original authority. */
export async function mayAdmitPluginRun(tx: SqlExecutor, userId: number, appId: string): Promise<boolean> {
	const blocked = await tx.one(
		`SELECT 1 FROM agent_plugin_app_packages ref
		 LEFT JOIN agent_plugin_packages p ON p.user_id=ref.user_id AND p.package_id=ref.package_id
		 LEFT JOIN agent_plugin_publishers k ON k.user_id=p.user_id AND k.key_id=p.publisher_key_id
		 WHERE ref.user_id=? AND ref.app_id=? AND ref.kind IN ('app','tool')
		 AND (p.package_id IS NULL OR p.status<>'installed' OR p.version<>ref.version
		 OR p.package_hash<>ref.package_hash OR p.publisher_key_id<>ref.publisher_key_id
		 OR k.key_id IS NULL OR k.revoked_at IS NOT NULL) LIMIT 1`,
		[userId, appId],
	);
	return blocked === null;
}
