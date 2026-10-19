import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Current per-user trust, not a cached publisher or global installed flag. */
export async function pluginTrust(tx: SqlReader, userId: number, appId: string, version: string): Promise<boolean> {
	const row = await tx.one(
		"SELECT i.revision FROM agent_plugin_installations i JOIN agent_plugin_publishers p ON p.user_id=i.user_id AND p.key_id=i.publisher_key_id WHERE i.user_id=? AND i.app_id=? AND i.version=? AND i.status='installed' AND p.revoked_at IS NULL",
		[userId, appId, version],
	);
	return row !== null;
}
