import type { DatabaseSync as Database } from 'node:sqlite';
import type { SqliteMigration } from './migration.types';
import { tableExists, columnExists } from './schema-inspection';
import { createAgentProjectDirectoriesTableSQL, createAgentSshJobsTableSQL } from '../schema/agent-workspace';

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
      (await tableExists(db, 'agent_host_cursors')) && !(await columnExists(db, 'agent_host_cursors', 'oldest_cursor')),
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
];
