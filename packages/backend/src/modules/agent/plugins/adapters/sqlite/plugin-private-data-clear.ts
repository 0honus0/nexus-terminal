import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { PluginStorageRefusal } from '../../storage/plugin-storage.js';

/** Keep CAS tombstones and original Operation receipts; remove the private document body. */
export async function clearPluginPrivateData(
	tx: SqlExecutor,
	userId: number,
	scope: { kind: 'app'; appId: string } | { kind: 'package'; packageId: string },
	now: number,
): Promise<number> {
	const appId = scope.kind === 'app' ? scope.appId : null;
	const packageId = scope.kind === 'package' ? scope.packageId : null;
	const exhausted = await tx.one(
		`SELECT 1 FROM agent_plugin_private_data WHERE user_id=?
	 AND (? IS NULL OR app_id=?) AND (? IS NULL OR package_id=?) AND document_json IS NOT NULL AND revision>=? LIMIT 1`,
		[userId, appId, appId, packageId, packageId, Number.MAX_SAFE_INTEGER],
	);
	if (exhausted) {
		throw new PluginStorageRefusal('version_conflict');
	}
	const result = await tx.run(
		`UPDATE agent_plugin_private_data SET document_json=NULL,revision=revision+1,updated_at=?
	 WHERE user_id=? AND (? IS NULL OR app_id=?) AND (? IS NULL OR package_id=?) AND document_json IS NOT NULL`,
		[now, userId, appId, appId, packageId, packageId],
	);
	return result.changes;
}
