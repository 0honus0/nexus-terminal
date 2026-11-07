import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { activatePluginScope } from '../../../scope/adapters/sqlite/plugin-scope-sql.js';
import { readDefinitionPackage } from '../../../scope/adapters/sqlite/definition-composition-row.js';
import { pluginManifest } from '../package/plugin-manifest.js';

/** Retire the duplicate execution role of an independently selected, frontend-only Surface. */
export async function separatePluginUiExecution(tx: SqlExecutor): Promise<void> {
	const apps = await tx.all(`SELECT a.* FROM agent_apps a JOIN agent_plugin_installations i
	 ON i.user_id=a.user_id AND i.app_id=a.id WHERE i.status='installed'`);
	for (const app of apps) {
		if (typeof app.user_id !== 'number' || typeof app.id !== 'string' || (app.enabled !== 0 && app.enabled !== 1)) {
			throw new Error('Invalid App during Surface dependency migration');
		}
		const rows = await tx.all(
			`SELECT ref.*,v.manifest_json FROM agent_plugin_app_packages ref
		 JOIN agent_plugin_versions v ON v.user_id=ref.user_id AND v.definition_id=ref.package_id
		 AND v.version=ref.version AND v.package_hash=ref.package_hash AND v.publisher_key_id=ref.publisher_key_id
		 WHERE ref.user_id=? AND ref.app_id=?`,
			[app.user_id, app.id],
		);
		const candidates = rows.map((row) => {
			if (typeof row.manifest_json !== 'string') {
				throw new Error('Missing migration package manifest');
			}
			return { row, manifest: pluginManifest(JSON.parse(row.manifest_json)) };
		});
		const duplicate = candidates.find(
			({ row, manifest }) =>
				row.kind === 'tool' &&
				row.selected_root === 0 &&
				manifest.backendEntry === null &&
				candidates.some((other) => other.row.kind === 'ui' && other.row.package_id === row.package_id) &&
				!candidates.some((other) =>
					other.manifest.dependencies.some((dependency) => dependency.packageId === row.package_id),
				),
		);
		if (!duplicate) {
			continue;
		}
		const execution = candidates.filter(({ row }) => row.kind !== 'ui' && row !== duplicate.row);
		const main = execution.find(({ row }) => row.kind === 'app');
		if (!main) {
			throw new Error('Missing App during Surface dependency migration');
		}
		await tx.run(
			"DELETE FROM agent_plugin_app_packages WHERE user_id=? AND app_id=? AND package_id=? AND kind='tool'",
			[app.user_id, app.id, duplicate.manifest.id],
		);
		await activatePluginScope(tx, {
			mode: 'selection',
			userId: app.user_id,
			appId: app.id,
			definitionId: main.manifest.id,
			definitionVersion: main.manifest.version,
			contentHash: readDefinitionPackage(main.row).packageHash,
			displayName: main.manifest.displayName,
			executionPackages: execution.map(({ row }) => readDefinitionPackage(row)),
			capabilities: [...new Set(execution.flatMap(({ manifest }) => manifest.capabilities))],
			enabled: app.enabled === 1,
			grantedCapabilities: null,
			now: Date.now(),
		});
	}
}
