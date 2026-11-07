import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

// This predicate identifies the signed, pre-operation tool contract. It is used
// only during migration; executable manifest readers accept the current contract.
function retiredTools(column: string): string {
	return `json_extract(${column},'$.schemaVersion')=2 AND EXISTS(
 SELECT 1 FROM json_each(${column},'$.contributions.tools') tool
 WHERE json_type(tool.value,'$.discovery') IS NOT 'object'
 OR json_type(tool.value,'$.childAccess') IS NOT 'text'
 OR json_type(tool.value,'$.hostOperations') IS NOT 'array'
 OR json_type(tool.value,'$.capability') IS NOT NULL
 OR json_type(tool.value,'$.risk') IS NOT NULL
 OR json_type(tool.value,'$.mutation') IS NOT NULL
 OR json_type(tool.value,'$.scheduling') IS NOT NULL
 OR json_extract(tool.value,'$.executionProfile') NOT IN ('general','managed'))`;
}

/** Preserve signed historical bytes while retiring their executable projections atomically. */
export async function retirePreviousPluginToolContract(tx: SqlExecutor): Promise<void> {
	const now = Date.now();
	await tx.exec(`INSERT INTO agent_plugin_legacy_versions
	 SELECT v.user_id,v.definition_id,v.version,v.package_hash,v.publisher_key_id,v.stage_id,s.user_id,s.size_bytes,v.manifest_json
	 FROM agent_plugin_versions v JOIN agent_plugin_stages s ON s.id=v.stage_id WHERE ${retiredTools('v.manifest_json')};`);

	// An old pending candidate may already have migrated data. Restoring the
	// current package to installed would bypass that durable rollback fence.
	const affectedPackages = `SELECT p.user_id,p.package_id FROM agent_plugin_packages p
	 WHERE EXISTS(SELECT 1 FROM agent_plugin_legacy_versions a
	 WHERE a.user_id=p.user_id AND a.definition_id=p.package_id AND a.version=p.version AND ${retiredTools('a.manifest_json')})
	 OR EXISTS(SELECT 1 FROM agent_plugin_package_updates u JOIN agent_plugin_stages s ON s.id=u.stage_id
	 WHERE u.user_id=p.user_id AND u.package_id=p.package_id AND ${retiredTools('s.manifest_json')})`;
	const affectedApps = `SELECT DISTINCT ref.user_id,ref.app_id FROM agent_plugin_app_packages ref
	 WHERE (ref.user_id,ref.package_id) IN (${affectedPackages})`;
	const exhausted = await tx.one(
		`SELECT 1 FROM agent_plugin_packages WHERE (user_id,package_id) IN (${affectedPackages}) AND status<>'incompatible' AND revision>=?
		 UNION ALL SELECT 1 FROM agent_plugin_installations WHERE (user_id,app_id) IN (${affectedApps})
		 AND status<>'removed' AND revision>=? LIMIT 1`,
		[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	);
	if (exhausted) {
		throw new Error('Plugin contract retirement revision exhausted');
	}
	await tx.run(
		`UPDATE agent_plugin_packages SET status='incompatible',revision=revision+1,updated_at=?
		 WHERE status<>'incompatible' AND (user_id,package_id) IN (${affectedPackages})`,
		[now],
	);
	await tx.exec(`UPDATE agent_apps SET enabled=0 WHERE (user_id,id) IN (${affectedApps});`);
	await tx.run(
		`UPDATE agent_plugin_installations SET status='removed',revision=revision+1,updated_at=?
		 WHERE status<>'removed' AND (user_id,app_id) IN (${affectedApps})`,
		[now],
	);
	await tx.exec(`DELETE FROM agent_plugin_retirements WHERE (user_id,app_id) IN (${affectedApps});
	 DELETE FROM agent_plugin_package_updates WHERE data_migrated=0 AND (user_id,package_id) IN (${affectedPackages});
	 UPDATE agent_plugin_versions SET manifest_json=json_object('format','legacy-archive','packageId',definition_id,'version',version,
	 'displayName',json_extract(manifest_json,'$.displayName'),'capabilities',json(json_extract(manifest_json,'$.capabilities')))
	 WHERE ${retiredTools('manifest_json')};
	 UPDATE agent_plugin_stages SET status='failed',manifest_json=NULL,publisher_key_id=NULL WHERE ${retiredTools('manifest_json')}
	 AND NOT EXISTS(SELECT 1 FROM agent_plugin_package_updates u WHERE u.stage_id=agent_plugin_stages.id AND u.data_migrated=1);
	 UPDATE agent_plugin_stages SET status='failed' WHERE ${retiredTools('manifest_json')};`);
}
