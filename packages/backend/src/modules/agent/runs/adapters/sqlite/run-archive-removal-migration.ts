import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** SDK1–3 execution history is deliberately removed, never converted into executable SDK4 state. */
export async function removeArchivedRunData(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TEMP TABLE agent_removed_runs(id TEXT PRIMARY KEY);
	 INSERT INTO agent_removed_runs
	 WITH RECURSIVE removed(id) AS (
	 SELECT r.id FROM agent_runs r LEFT JOIN agent_run_inputs i ON i.run_id=r.id
	 WHERE i.run_id IS NULL OR json_extract(i.app_execution_json,'$.kind')='retired'
	 OR NOT EXISTS(SELECT 1 FROM agent_plugin_installations p WHERE p.user_id=r.user_id AND p.app_id=r.app_id)
	 OR EXISTS(SELECT 1 FROM agent_plugin_app_packages ref JOIN agent_plugin_versions v
	 ON v.user_id=ref.user_id AND v.definition_id=ref.package_id AND v.version=ref.version
	 WHERE ref.user_id=r.user_id AND ref.app_id=r.app_id AND COALESCE(json_extract(v.manifest_json,'$.schemaVersion'),0)<>4)
	 OR EXISTS(SELECT 1 FROM agent_plugin_versions v WHERE v.user_id=r.user_id
	 AND v.definition_id=json_extract(i.app_execution_json,'$.package.packageId')
	 AND v.version=json_extract(i.app_execution_json,'$.package.version')
	 AND COALESCE(json_extract(v.manifest_json,'$.schemaVersion'),0)<>4)
	 OR EXISTS(SELECT 1 FROM json_each(i.app_execution_json,'$.codeDependencies') dependency
	 JOIN agent_plugin_versions v ON v.user_id=r.user_id
	 AND v.definition_id=json_extract(dependency.value,'$.packageId')
	 AND v.version=json_extract(dependency.value,'$.version')
	 WHERE COALESCE(json_extract(v.manifest_json,'$.schemaVersion'),0)<>4)
	 UNION SELECT c.parent_id FROM agent_run_children c JOIN removed r ON c.run_id=r.id
	 UNION SELECT c.run_id FROM agent_run_children c JOIN removed r ON c.parent_id=r.id
	 ) SELECT id FROM removed;
	 DROP TABLE agent_context_checkpoints;
	 DROP TABLE agent_model_contexts;
	 DROP TABLE agent_context_compactions;
	 DROP TABLE agent_thread_titles;
	 DROP TABLE agent_run_budget_reservations;
	 DROP TABLE agent_legacy_run_children;
	 DROP TABLE agent_legacy_run_mailbox;
	 DROP TABLE agent_legacy_collaboration_effects;
	 DROP TABLE agent_legacy_tool_jobs;
	 DROP TABLE agent_legacy_project_effects;
	 DROP TABLE agent_tool_children;
	 DROP TABLE agent_run_tool_events;
	 DROP TABLE agent_governance_resolution_keys;
	 DROP TABLE agent_governance_approvals;
	 DROP TABLE agent_run_tools;
	 DROP TABLE agent_run_model_step_events;
	 DROP TABLE agent_run_model_steps;
	 DROP TABLE agent_run_frozen_inputs;
	 DROP TABLE agent_integration_rejections;
	 DROP TABLE agent_integration_intents;
	 DROP TABLE agent_integrations;
	 DELETE FROM agent_run_children WHERE run_id IN agent_removed_runs OR parent_id IN agent_removed_runs;
	 DELETE FROM agent_run_mailbox WHERE root_id IN agent_removed_runs OR recipient_id IN agent_removed_runs OR sender_id IN agent_removed_runs;
	 DELETE FROM agent_run_facts WHERE root_id IN agent_removed_runs OR author_id IN agent_removed_runs;
	 DELETE FROM agent_artifact_attachments WHERE run_id IN agent_removed_runs;
	 DELETE FROM agent_memories WHERE source_run_id IN agent_removed_runs;
	 DELETE FROM agent_runs WHERE id IN agent_removed_runs;
	 DROP TABLE agent_removed_runs;`);
}
