import type { DatabaseSync as Database } from 'node:sqlite';
import type { SqliteMigration } from './migration.types';
import { tableExists, columnExists } from './schema-inspection';
import { createAgentProjectDirectoriesTableSQL, createAgentSshJobsTableSQL } from '../schema/agent-ssh';

export const agentHostMigrations: SqliteMigration[] = [
	{
		id: 46,
		name: 'Persist pending Plugin upgrade continuations',

		check: async (db: Database): Promise<boolean> => !(await tableExists(db, 'agent_plugin_pending_upgrades')),

		sql: `
      CREATE TABLE agent_plugin_pending_upgrades (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        app_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        from_version TEXT NOT NULL,
        target_version TEXT NOT NULL,
        package_hash TEXT NOT NULL,
        app_state_version INTEGER NOT NULL CHECK(app_state_version > 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, app_id),
        FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
      );
      CREATE INDEX agent_plugin_pending_upgrades_user
      ON agent_plugin_pending_upgrades(user_id, updated_at DESC, app_id);
    `,
	},
	{
		id: 47,
		name: 'Bound durable Agent Host event retention',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_host_cursors')) &&
			!(await columnExists(db, 'agent_host_cursors', 'oldest_cursor')),

		sql: `
      ALTER TABLE agent_host_cursors
      ADD COLUMN oldest_cursor INTEGER NOT NULL DEFAULT 0 CHECK(oldest_cursor >= 0);

      UPDATE agent_host_cursors
      SET oldest_cursor = MAX(0, next_sequence - 1 - 2048);

      DELETE FROM agent_host_events
      WHERE sequence <= COALESCE(
        (SELECT oldest_cursor
         FROM agent_host_cursors
         WHERE agent_host_cursors.user_id = agent_host_events.user_id),
        0
      );
    `,
	},
	{
		id: 48,
		name: 'Upgrade persisted Agent settings after retired fields and model fallbacks',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_settings'),

		sql: `
      UPDATE agent_settings
      SET value_json = json_insert(
        json_remove(
          value_json,
          '$.safety',
          '$.budget.maxRunTokens',
          '$.budget.maxContextTokens',
          '$.budget.maxOutputTokens',
          '$.budget.maxRawToolBytes',
          '$.budget.maxRunCostMicros',
          '$.hardLimits.maxRunTokens',
          '$.hardLimits.maxContextTokens',
          '$.hardLimits.maxOutputTokens',
          '$.hardLimits.maxRawToolBytes',
          '$.hardLimits.maxRunCostMicros',
          '$.hardLimits.workspaceIdleTtlSeconds',
          '$.workspaceRuntime.workspaceIdleTtlSeconds'
        ),
        '$.model.fallbackModels', json('[]')
      )
      WHERE json_extract(value_json, '$.schemaVersion') = 1
        AND (
          json_type(value_json, '$.safety') IS NOT NULL
          OR json_type(value_json, '$.budget.maxRunTokens') IS NOT NULL
          OR json_type(value_json, '$.budget.maxContextTokens') IS NOT NULL
          OR json_type(value_json, '$.budget.maxOutputTokens') IS NOT NULL
          OR json_type(value_json, '$.budget.maxRawToolBytes') IS NOT NULL
          OR json_type(value_json, '$.budget.maxRunCostMicros') IS NOT NULL
          OR json_type(value_json, '$.hardLimits.maxRunTokens') IS NOT NULL
          OR json_type(value_json, '$.hardLimits.maxContextTokens') IS NOT NULL
          OR json_type(value_json, '$.hardLimits.maxOutputTokens') IS NOT NULL
          OR json_type(value_json, '$.hardLimits.maxRawToolBytes') IS NOT NULL
          OR json_type(value_json, '$.hardLimits.maxRunCostMicros') IS NOT NULL
          OR json_type(value_json, '$.hardLimits.workspaceIdleTtlSeconds') IS NOT NULL
          OR json_type(value_json, '$.workspaceRuntime.workspaceIdleTtlSeconds') IS NOT NULL
          OR json_type(value_json, '$.model.fallbackModels') IS NULL
        );
    `,
	},
	{
		id: 49,
		name: 'Add durable Agent SSH background jobs',
		sql: createAgentSshJobsTableSQL,
	},
	{
		id: 50,
		name: 'Add conversation SSH project directories',
		sql: createAgentProjectDirectoriesTableSQL,
	},
	{
		id: 54,
		name: 'Add configurable Workspace Job capacity to persisted Agent settings',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_settings'),

		sql: `
      UPDATE agent_settings
      SET value_json = json_insert(value_json,
        '$.performance.maxConcurrentWorkspaceJobs', 8)
      WHERE json_extract(value_json, '$.schemaVersion') = 1
        AND json_type(value_json, '$.performance') = 'object'
        AND json_type(value_json, '$.performance.maxConcurrentWorkspaceJobs') IS NULL;
    `,
	},
	{
		id: 55,
		name: 'Remove retired Agent Plugin Runner entry',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_plugin_versions')) &&
			(await columnExists(db, 'agent_plugin_versions', 'runner_entry')),

		sql: 'ALTER TABLE agent_plugin_versions DROP COLUMN runner_entry;',
	},
	{
		id: 56,
		name: 'Remove retired Runner Workspace ACP profiles',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_workspaces')) &&
			(await columnExists(db, 'agent_workspaces', 'acp_profiles_json')),

		sql: `
      ALTER TABLE agent_workspaces DROP COLUMN acp_profiles_json;
      UPDATE agent_settings
      SET value_json = json_remove(value_json, '$.workspaceRuntime.acpProfiles')
      WHERE json_type(value_json, '$.workspaceRuntime.acpProfiles') IS NOT NULL;
    `,
	},
	{
		id: 57,
		name: 'Remove retired Agent Workspace management confirmations',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_workspace_runtime_confirmations'),

		sql: 'DROP TABLE IF EXISTS agent_workspace_runtime_confirmations;',
	},
	{
		id: 58,
		name: 'Drop retired Agent Workspace metadata and runtime commands',
		sql: `
      DROP TABLE IF EXISTS agent_workspace_runtime_commands;
      DROP TABLE IF EXISTS agent_workspaces;
      UPDATE agent_settings
      SET value_json = json_remove(value_json,
        '$.workspaceRuntime',
        '$.performance.maxConcurrentWorkspaceJobs',
        '$.hardLimits.maxActiveWorkspaces')
      WHERE json_valid(value_json);
    `,

		verify: async (db: Database): Promise<boolean> =>
			!(await tableExists(db, 'agent_workspace_runtime_commands')) &&
			!(await tableExists(db, 'agent_workspaces')),
	},
	{
		id: 59,
		name: 'Remove retired Runner targets from persisted Plugin version manifests',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_versions'),

		sql: `
      UPDATE agent_plugin_versions
      SET manifest_json = json_remove(manifest_json, '$.targets.runner')
      WHERE json_type(manifest_json, '$.targets.runner') IS NOT NULL;
    `,
	},
	{
		id: 60,
		name: 'Remove retired Runner targets from staged Plugin manifests',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_stages'),

		sql: `
      UPDATE agent_plugin_stages
      SET manifest_json = json_remove(manifest_json, '$.targets.runner')
      WHERE manifest_json IS NOT NULL
        AND json_type(manifest_json, '$.targets.runner') IS NOT NULL;
    `,
	},
	{
		id: 61,
		name: 'Remove retired Workspace capability from persisted Plugin manifests',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_versions'),

		sql: `
      UPDATE agent_plugin_versions
      SET manifest_json = json_set(manifest_json, '$.capabilities', json((
        SELECT json_group_array(value)
        FROM json_each(agent_plugin_versions.manifest_json, '$.capabilities')
        WHERE value <> 'workspace.manage'
      )))
      WHERE EXISTS (
        SELECT 1 FROM json_each(manifest_json, '$.capabilities') WHERE value = 'workspace.manage'
      );
    `,
	},
	{
		id: 62,
		name: 'Remove retired Workspace capability from staged Plugin manifests',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_stages'),

		sql: `
      UPDATE agent_plugin_stages
      SET manifest_json = json_set(manifest_json, '$.capabilities', json((
        SELECT json_group_array(value)
        FROM json_each(agent_plugin_stages.manifest_json, '$.capabilities')
        WHERE value <> 'workspace.manage'
      )))
      WHERE manifest_json IS NOT NULL AND EXISTS (
        SELECT 1 FROM json_each(manifest_json, '$.capabilities') WHERE value = 'workspace.manage'
      );
    `,
	},
	{
		id: 63,
		name: 'Remove retired Workspace app grants and target scopes',

		check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_app_grants'),

		sql: `
      DELETE FROM agent_app_grants WHERE capability = 'workspace.manage';
      UPDATE agent_app_grants
      SET scope_json = json_remove(scope_json, '$.targets.workspace')
      WHERE json_type(scope_json, '$.targets.workspace') IS NOT NULL;
    `,
	},
	{
		id: 64,
		name: 'Remove retired Workspace delegated grants and target scopes',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_delegations')) &&
			(await columnExists(db, 'agent_delegations', 'grants_json')),

		sql: `
      UPDATE agent_delegations
      SET grants_json = (
        SELECT json_group_array(json(json_remove(source.value, '$.scope.targets.workspace')))
        FROM json_each(agent_delegations.grants_json) AS source
        WHERE json_extract(source.value, '$.capability') <> 'workspace.manage'
      )
      WHERE EXISTS (
        SELECT 1 FROM json_each(grants_json) AS source
        WHERE json_extract(source.value, '$.capability') = 'workspace.manage'
          OR json_type(source.value, '$.scope.targets.workspace') IS NOT NULL
      );
    `,
	},
];
