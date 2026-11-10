import type { SqlExecutor } from '../../sql-types.js';

/** Retire the old feature only after its external effects and processes have settled. */
export async function removeRetiredAgent(tx: SqlExecutor): Promise<void> {
	const pending =
		await tx.one(`SELECT id FROM agent_operations WHERE kind <> 'model' AND state IN ('dispatched','unknown')
	UNION ALL SELECT id FROM agent_tool_jobs WHERE state IN ('dispatched','unknown')
	UNION ALL SELECT instance_id AS id FROM agent_plugin_runtime_instances WHERE state <> 'closed' LIMIT 1`);
	if (pending) {
		throw new Error(
			'Retired Agent has unsettled external work. Stop it and resolve unknown effects with the previous version before upgrading.',
		);
	}
	await tx.exec(`PRAGMA defer_foreign_keys=ON;
	DROP TABLE agent_app_checkpoints;
	DROP TABLE agent_app_declared_capabilities;
	DROP TABLE agent_app_definition_packages;
	DROP TABLE agent_app_message_chunks;
	DROP TABLE agent_app_messages;
	DROP TABLE agent_artifact_attachments;
	DROP TABLE agent_artifact_blob_removals;
	DROP TABLE agent_artifact_cleanup_items;
	DROP TABLE agent_artifact_cleanup;
	DROP TABLE agent_artifact_grants;
	DROP TABLE agent_collaboration_effects;
	DROP TABLE agent_command_idempotency;
	DROP TABLE agent_execution_settings;
	DROP TABLE agent_governance_grants;
	DROP TABLE agent_governance_policies;
	DROP TABLE agent_hard_limit_confirmations;
	DROP TABLE agent_memories;
	DROP TABLE agent_model_capability_registry;
	DROP TABLE agent_operation_approval_commands;
	DROP TABLE agent_operation_approvals;
	DROP TABLE agent_operation_artifacts;
	DROP TABLE agent_artifacts;
	DROP TABLE agent_operation_authorities;
	DROP TABLE agent_operation_content_chunks;
	DROP TABLE agent_operation_contents;
	DROP TABLE agent_operation_diagnostics;
	DROP TABLE agent_operation_model_reservations;
	DROP TABLE agent_plugin_app_packages;
	DROP TABLE agent_plugin_configuration_mutations;
	DROP TABLE agent_plugin_connections;
	DROP TABLE agent_plugin_data;
	DROP TABLE agent_plugin_data_migrations;
	DROP TABLE agent_plugin_data_operations;
	DROP TABLE agent_plugin_data_purges;
	DROP TABLE agent_plugin_extension_data;
	DROP TABLE agent_plugin_extension_operations;
	DROP TABLE agent_plugin_app_bindings;
	DROP TABLE agent_plugin_intents;
	DROP TABLE agent_plugin_package_updates;
	DROP TABLE agent_plugin_private_data;
	DROP TABLE agent_plugin_publishers;
	DROP TABLE agent_plugin_repositories;
	DROP TABLE agent_plugin_retirements;
	DROP TABLE agent_plugin_runtime_history;
	DROP TABLE agent_plugin_installations;
	DROP TABLE agent_plugin_runtime_instances;
	DROP TABLE agent_plugin_instances;
	DROP TABLE agent_plugin_packages;
	DROP TABLE agent_plugin_versions;
	DROP TABLE agent_plugin_stages;
	DROP TABLE agent_project_effects;
	DROP TABLE agent_providers;
	DROP TABLE agent_run_children;
	DROP TABLE agent_run_events;
	DROP TABLE agent_run_execution_settings;
	DROP TABLE agent_run_facts;
	DROP TABLE agent_run_inputs;
	DROP TABLE agent_run_mailbox;
	DROP TABLE agent_run_mailbox_cursors;
	DROP TABLE agent_run_projects;
	DROP TABLE agent_run_resume_commands;
	DROP TABLE agent_run_suspensions;
	DROP TABLE agent_target_denylist;
	DROP TABLE agent_target_denylist_meta;
	DROP TABLE agent_thread_commands;
	DROP TABLE agent_tool_jobs;
	DROP TABLE agent_operations;
	DROP TABLE agent_run_executions;
	DROP TABLE agent_runs;
	DROP TABLE agent_threads;
	DROP TABLE agent_apps;
	DROP TABLE agent_app_definitions;`);
}
