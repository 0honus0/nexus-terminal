import * as core from './schema/core';
import * as agentHost from './schema/agent-host';
import * as agentAi from './schema/agent-ai';
import * as agentExecution from './schema/agent-execution';
import * as agentCollaboration from './schema/agent-collaboration';
import * as agentPlugins from './schema/agent-plugins';
import * as agentWorkspace from './schema/agent-workspace';

export interface SqliteTableDefinition {
  name: string;
  sql: string;
}

/** Current base schema. Released/main history, including Agent schema changes, evolves through sqlite-migrations. */
export const sqliteTableDefinitions: readonly SqliteTableDefinition[] = [
  { name: 'settings', sql: core.createSettingsTableSQL },
  { name: 'settings_migrations', sql: core.createSettingsMigrationsTableSQL },
  { name: 'audit_logs', sql: core.createAuditLogsTableSQL },
  { name: 'notification_settings', sql: core.createNotificationSettingsTableSQL },
  { name: 'users', sql: core.createUsersTableSQL },
  { name: 'passkeys', sql: core.createPasskeysTableSQL },
  { name: 'proxies', sql: core.createProxiesTableSQL },
  { name: 'ssh_keys', sql: core.createSshKeysTableSQL },
  { name: 'connections', sql: core.createConnectionsTableSQL },
  { name: 'tags', sql: core.createTagsTableSQL },
  { name: 'connection_tags', sql: core.createConnectionTagsTableSQL },
  { name: 'ip_blacklist', sql: core.createIpBlacklistTableSQL },
  { name: 'command_history', sql: core.createCommandHistoryTableSQL },
  { name: 'path_history', sql: core.createPathHistoryTableSQL },
  { name: 'quick_commands', sql: core.createQuickCommandsTableSQL },
  { name: 'quick_command_tags', sql: core.createQuickCommandTagsTableSQL },
  { name: 'quick_command_tag_associations', sql: core.createQuickCommandTagAssociationsTableSQL },
  { name: 'favorite_paths', sql: core.createFavoritePathsTableSQL },
  { name: 'terminal_themes', sql: core.createTerminalThemesTableSQL },
  { name: 'appearance_settings', sql: core.createAppearanceSettingsTableSQL },
  { name: 'agent_apps', sql: agentHost.createAgentAppsTableSQL },
  { name: 'agent_app_grants', sql: agentHost.createAgentAppGrantsTableSQL },
  { name: 'agent_app_storage', sql: agentHost.createAgentAppStorageTableSQL },
  { name: 'agent_settings', sql: agentHost.createAgentSettingsTableSQL },
  { name: 'agent_hard_limit_confirmations', sql: agentHost.createAgentHardLimitConfirmationsTableSQL },
  { name: 'agent_target_denylist', sql: agentHost.createAgentTargetDenylistTableSQL },
  { name: 'agent_target_denylist_meta', sql: agentHost.createAgentTargetDenylistMetaTableSQL },
  { name: 'ai_providers', sql: agentAi.createAiProvidersTableSQL },
  { name: 'ai_artifacts', sql: agentAi.createAiArtifactsTableSQL },
  { name: 'agent_quota_usage', sql: agentAi.createAgentQuotaUsageTableSQL },
  { name: 'ai_threads', sql: agentExecution.createAiThreadsTableSQL },
  { name: 'agent_runs', sql: agentExecution.createAgentRunsTableSQL },
  { name: 'agent_ssh_jobs', sql: agentWorkspace.createAgentSshJobsTableSQL },
  { name: 'agent_project_directories', sql: agentWorkspace.createAgentProjectDirectoriesTableSQL },
  { name: 'agent_loop_guards', sql: agentExecution.createAgentLoopGuardsTableSQL },
  { name: 'ai_thread_entries', sql: agentExecution.createAiThreadEntriesTableSQL },
  { name: 'ai_thread_entries_search', sql: agentExecution.createAiThreadEntrySearchIndexSQL },
  { name: 'agent_artifact_links', sql: agentAi.createAgentArtifactLinksTableSQL },
  { name: 'agent_artifact_grants', sql: agentAi.createAgentArtifactGrantsTableSQL },
  { name: 'agent_artifact_cleanup_confirmations', sql: agentAi.createAgentArtifactCleanupConfirmationsTableSQL },
  { name: 'ai_context_checkpoints', sql: agentAi.createAiContextCheckpointsTableSQL },
  { name: 'ai_memories', sql: agentAi.createAiMemoriesTableSQL },
  { name: 'ai_memories_search', sql: agentAi.createAiMemorySearchIndexSQL },
  { name: 'agent_runtimes', sql: agentExecution.createAgentRuntimesTableSQL },
  { name: 'agent_steps', sql: agentExecution.createAgentStepsTableSQL },
  { name: 'agent_model_attempts', sql: agentExecution.createAgentModelAttemptsTableSQL },
  { name: 'agent_tool_calls', sql: agentExecution.createAgentToolCallsTableSQL },
  { name: 'agent_input_requests', sql: agentExecution.createAgentInputRequestsTableSQL },
  { name: 'agent_events', sql: agentExecution.createAgentEventsTableSQL },
  { name: 'agent_host_events', sql: agentHost.createAgentHostEventsTableSQL },
  { name: 'agent_commands', sql: agentExecution.createAgentCommandsTableSQL },
  { name: 'agent_checkpoints', sql: agentExecution.createAgentCheckpointsTableSQL },
  { name: 'agent_approvals', sql: agentExecution.createAgentApprovalsTableSQL },
  { name: 'agent_resource_fences', sql: agentExecution.createAgentResourceFencesTableSQL },
  { name: 'agent_leases', sql: agentExecution.createAgentLeasesTableSQL },
  { name: 'agent_resource_quarantine', sql: agentExecution.createAgentResourceQuarantineTableSQL },
  { name: 'agent_workspaces', sql: agentWorkspace.createAgentWorkspacesTableSQL },
  { name: 'agent_workspace_runtime_commands', sql: agentWorkspace.createAgentWorkspaceRuntimeCommandsTableSQL },
  { name: 'agent_integrations', sql: agentExecution.createAgentIntegrationsTableSQL },
  { name: 'agent_delegations', sql: agentCollaboration.createAgentDelegationsTableSQL },
  { name: 'agent_runtime_context_checkpoints', sql: agentCollaboration.createAgentRuntimeContextCheckpointsTableSQL },
  { name: 'agent_mailbox_cursors', sql: agentCollaboration.createAgentMailboxCursorsTableSQL },
  { name: 'agent_messages', sql: agentCollaboration.createAgentMessagesTableSQL },
  { name: 'agent_scheduler_work', sql: agentCollaboration.createAgentSchedulerWorkTableSQL },
  { name: 'agent_delegation_edges', sql: agentCollaboration.createAgentDelegationEdgesTableSQL },
  { name: 'agent_shared_facts', sql: agentCollaboration.createAgentSharedFactsTableSQL },
  { name: 'agent_memory_import_confirmations', sql: agentAi.createAgentMemoryImportConfirmationsTableSQL },
  { name: 'agent_publisher_keys', sql: agentPlugins.createAgentPublisherKeysTableSQL },
  { name: 'agent_plugin_stages', sql: agentPlugins.createAgentPluginStagesTableSQL },
  { name: 'agent_plugin_pending_upgrades', sql: agentPlugins.createAgentPluginPendingUpgradesTableSQL },
  { name: 'agent_plugin_versions', sql: agentPlugins.createAgentPluginVersionsTableSQL },
  { name: 'agent_plugin_installations', sql: agentPlugins.createAgentPluginInstallationsTableSQL },
  { name: 'agent_app_intent_receipts', sql: agentPlugins.createAgentAppIntentReceiptsTableSQL },
  { name: 'agent_app_intent_artifact_grants', sql: agentPlugins.createAgentAppIntentArtifactGrantsTableSQL },
];

export const sqlitePostMigrationDefinitions: readonly SqliteTableDefinition[] = [
  { name: 'agent_one_recovery_checkpoint_per_run', sql: agentExecution.createAgentRecoveryCheckpointIndexSQL },
];
