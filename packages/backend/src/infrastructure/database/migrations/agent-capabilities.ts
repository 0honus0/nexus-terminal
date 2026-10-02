import type { DatabaseSync as Database } from 'node:sqlite';
import type { SqliteMigration } from './migration.types';
import { tableExists, columnExists } from './schema-inspection';

export const agentCapabilitiesMigrations: SqliteMigration[] = [
  {
    id: 35,
    name: 'Replace legacy Agent grant scopes and remove superseded file capabilities',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_app_grants'),
    sql: `
            CREATE TEMP TABLE agent_app_grants_v2 AS
            SELECT
              user_id,
              app_id,
              CASE capability
                WHEN 'workspace.read' THEN 'file.read'
                WHEN 'machine.files.read' THEN 'file.read'
                WHEN 'workspace.write' THEN 'file.write'
                WHEN 'machine.files.write' THEN 'file.write'
                ELSE capability
              END AS capability,
              MAX(granted_at) AS granted_at,
              MAX(CASE
                WHEN capability IN ('workspace.read','workspace.write','file.read','file.write','file.delete') THEN 1
                ELSE 0
              END) AS workspace_allowed,
              MAX(CASE
                WHEN capability IN ('machine.files.read','machine.files.write','file.read','file.write','file.delete') THEN 1
                ELSE 0
              END) AS ssh_allowed
            FROM agent_app_grants
            GROUP BY user_id, app_id, CASE capability
              WHEN 'workspace.read' THEN 'file.read'
              WHEN 'machine.files.read' THEN 'file.read'
              WHEN 'workspace.write' THEN 'file.write'
              WHEN 'machine.files.write' THEN 'file.write'
              ELSE capability
            END;

            DELETE FROM agent_app_grants;

            INSERT INTO agent_app_grants
              (user_id, app_id, capability, schema_version, scope_json, granted_at)
            SELECT
              user_id,
              app_id,
              capability,
              2,
              CASE
                WHEN capability IN ('file.read','file.write','file.delete') AND workspace_allowed = 1 AND ssh_allowed = 1
                  THEN '{"kind":"targets","targets":{"workspace":{"mode":"all"},"ssh":{"mode":"all"}}}'
                WHEN capability IN ('file.read','file.write','file.delete') AND workspace_allowed = 1
                  THEN '{"kind":"targets","targets":{"workspace":{"mode":"all"}}}'
                WHEN capability IN ('file.read','file.write','file.delete') AND ssh_allowed = 1
                  THEN '{"kind":"targets","targets":{"ssh":{"mode":"all"}}}'
                WHEN capability IN ('file.read','file.write','file.delete')
                  THEN '{"kind":"targets","targets":{}}'
                ELSE '{"kind":"global"}'
              END,
              granted_at
            FROM agent_app_grants_v2;

            DROP TABLE agent_app_grants_v2;
        `,
  },
  {
    id: 36,
    name: 'Replace Subagent capability strings with scoped delegated grants',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'agent_delegations')) &&
      (await columnExists(db, 'agent_delegations', 'capabilities_json')),
    sql: `
            ALTER TABLE agent_delegations RENAME COLUMN capabilities_json TO grants_json;

            UPDATE agent_delegations AS delegation
            SET grants_json = COALESCE(
              (
                SELECT json_group_array(
                  json_object(
                    'capability', normalized.capability,
                    'schemaVersion', 2,
                    'scope', CASE
                      WHEN normalized.capability IN ('file.read','file.write','file.delete')
                        THEN json('{"kind":"targets","targets":{"workspace":{"mode":"all"}}}')
                      ELSE json('{"kind":"global"}')
                    END
                  )
                )
                FROM (
                  SELECT DISTINCT
                    CASE source.value
                      WHEN 'workspace.read' THEN 'file.read'
                      WHEN 'machine.files.read' THEN 'file.read'
                      WHEN 'workspace.write' THEN 'file.write'
                      WHEN 'machine.files.write' THEN 'file.write'
                      ELSE source.value
                    END AS capability
                  FROM json_each(delegation.grants_json) AS source
                ) AS normalized
              ),
              '[]'
            );
        `,
  },
  {
    id: 37,
    name: 'Rewrite persisted Plugin version manifests to canonical file capabilities',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_versions'),
    sql: `
            UPDATE agent_plugin_versions
            SET manifest_json = json_set(
              manifest_json,
              '$.capabilities',
              json(COALESCE((
                SELECT json_group_array(capability)
                FROM (
                  SELECT DISTINCT CASE source.value
                    WHEN 'workspace.read' THEN 'file.read'
                    WHEN 'machine.files.read' THEN 'file.read'
                    WHEN 'workspace.write' THEN 'file.write'
                    WHEN 'machine.files.write' THEN 'file.write'
                    ELSE source.value
                  END AS capability
                  FROM json_each(json_extract(agent_plugin_versions.manifest_json, '$.capabilities')) AS source
                  ORDER BY capability
                )
              ), '[]'))
            );
        `,
  },
  {
    id: 38,
    name: 'Rewrite staged Plugin manifests to canonical file capabilities',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_stages'),
    sql: `
            UPDATE agent_plugin_stages
            SET manifest_json = json_set(
              manifest_json,
              '$.capabilities',
              json(COALESCE((
                SELECT json_group_array(capability)
                FROM (
                  SELECT DISTINCT CASE source.value
                    WHEN 'workspace.read' THEN 'file.read'
                    WHEN 'machine.files.read' THEN 'file.read'
                    WHEN 'workspace.write' THEN 'file.write'
                    WHEN 'machine.files.write' THEN 'file.write'
                    ELSE source.value
                  END AS capability
                  FROM json_each(json_extract(agent_plugin_stages.manifest_json, '$.capabilities')) AS source
                  ORDER BY capability
                )
              ), '[]'))
            )
            WHERE manifest_json IS NOT NULL;
        `,
  },
  {
    id: 39,
    name: 'Replace split Workspace and SSH shell grants with canonical target-scoped shell authority',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_app_grants'),
    sql: `
            CREATE TEMP TABLE agent_shell_grants_v2 AS
            SELECT
              user_id,
              app_id,
              MAX(granted_at) AS granted_at,
              MAX(CASE WHEN capability = 'workspace.execute' THEN 1 ELSE 0 END) AS workspace_allowed,
              MAX(CASE WHEN capability = 'machine.shell.execute' THEN 1 ELSE 0 END) AS ssh_allowed
            FROM agent_app_grants
            WHERE capability IN ('workspace.execute','machine.shell.execute')
            GROUP BY user_id, app_id;

            DELETE FROM agent_app_grants
            WHERE capability IN ('workspace.execute','machine.shell.execute');

            INSERT INTO agent_app_grants
              (user_id, app_id, capability, schema_version, scope_json, granted_at)
            SELECT
              user_id,
              app_id,
              'shell.execute',
              2,
              CASE
                WHEN workspace_allowed = 1 AND ssh_allowed = 1
                  THEN '{"kind":"targets","targets":{"workspace":{"mode":"all"},"ssh":{"mode":"all"}}}'
                WHEN workspace_allowed = 1
                  THEN '{"kind":"targets","targets":{"workspace":{"mode":"all"}}}'
                WHEN ssh_allowed = 1
                  THEN '{"kind":"targets","targets":{"ssh":{"mode":"all"}}}'
                ELSE '{"kind":"targets","targets":{}}'
              END,
              granted_at
            FROM agent_shell_grants_v2;

            DROP TABLE agent_shell_grants_v2;
        `,
  },
  {
    id: 40,
    name: 'Replace split Subagent shell capabilities with scoped shell grants',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'agent_delegations')) && (await columnExists(db, 'agent_delegations', 'grants_json')),
    sql: `
            UPDATE agent_delegations AS delegation
            SET grants_json = COALESCE(
              (
                SELECT json_group_array(json(grant_json))
                FROM (
                  SELECT source.value AS grant_json
                  FROM json_each(delegation.grants_json) AS source
                  WHERE json_extract(source.value, '$.capability')
                    NOT IN ('workspace.execute','machine.shell.execute')

                  UNION ALL

                  SELECT json_object(
                    'capability', 'shell.execute',
                    'schemaVersion', 2,
                    'scope', CASE
                      WHEN EXISTS (
                        SELECT 1 FROM json_each(delegation.grants_json) AS workspace_source
                        WHERE json_extract(workspace_source.value, '$.capability') = 'workspace.execute'
                      ) AND EXISTS (
                        SELECT 1 FROM json_each(delegation.grants_json) AS ssh_source
                        WHERE json_extract(ssh_source.value, '$.capability') = 'machine.shell.execute'
                      )
                        THEN json('{"kind":"targets","targets":{"workspace":{"mode":"all"},"ssh":{"mode":"all"}}}')
                      WHEN EXISTS (
                        SELECT 1 FROM json_each(delegation.grants_json) AS workspace_source
                        WHERE json_extract(workspace_source.value, '$.capability') = 'workspace.execute'
                      )
                        THEN json('{"kind":"targets","targets":{"workspace":{"mode":"all"}}}')
                      ELSE json('{"kind":"targets","targets":{"ssh":{"mode":"all"}}}')
                    END
                  ) AS grant_json
                  WHERE EXISTS (
                    SELECT 1 FROM json_each(delegation.grants_json) AS shell_source
                    WHERE json_extract(shell_source.value, '$.capability')
                      IN ('workspace.execute','machine.shell.execute')
                  )
                )
              ),
              '[]'
            )
            WHERE EXISTS (
              SELECT 1 FROM json_each(delegation.grants_json) AS shell_source
              WHERE json_extract(shell_source.value, '$.capability')
                IN ('workspace.execute','machine.shell.execute')
            );
        `,
  },
  {
    id: 41,
    name: 'Rewrite persisted Plugin version manifests to canonical shell capability',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_versions'),
    sql: `
            UPDATE agent_plugin_versions
            SET manifest_json = json_set(
              manifest_json,
              '$.capabilities',
              json(COALESCE((
                SELECT json_group_array(capability)
                FROM (
                  SELECT DISTINCT CASE source.value
                    WHEN 'workspace.execute' THEN 'shell.execute'
                    WHEN 'machine.shell.execute' THEN 'shell.execute'
                    ELSE source.value
                  END AS capability
                  FROM json_each(json_extract(agent_plugin_versions.manifest_json, '$.capabilities')) AS source
                  ORDER BY capability
                )
              ), '[]'))
            );
        `,
  },
  {
    id: 42,
    name: 'Rewrite staged Plugin manifests to canonical shell capability',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_plugin_stages'),
    sql: `
            UPDATE agent_plugin_stages
            SET manifest_json = json_set(
              manifest_json,
              '$.capabilities',
              json(COALESCE((
                SELECT json_group_array(capability)
                FROM (
                  SELECT DISTINCT CASE source.value
                    WHEN 'workspace.execute' THEN 'shell.execute'
                    WHEN 'machine.shell.execute' THEN 'shell.execute'
                    ELSE source.value
                  END AS capability
                  FROM json_each(json_extract(agent_plugin_stages.manifest_json, '$.capabilities')) AS source
                  ORDER BY capability
                )
              ), '[]'))
            )
            WHERE manifest_json IS NOT NULL;
        `,
  },
  {
    id: 43,
    name: 'Project legacy Workspace shell results into typed execution semantics',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_tool_calls'),
    sql: `
            UPDATE agent_tool_calls
            SET result_json = json_set(
              result_json,
              '$.semantic',
              json_object(
                'kind', 'execution',
                'target', json_object(
                  'target', 'workspace',
                  'id', json_extract(inspection_json, '$.normalizedArguments.workspaceId')
                ),
                'status', COALESCE(
                  json_extract(result_json, '$.data.status'),
                  CASE
                    WHEN json_extract(result_json, '$.outcome') = 'unknown' THEN 'unknown'
                    WHEN json_extract(result_json, '$.ok') = 1
                      AND json_extract(result_json, '$.verification.status') = 'verified' THEN 'succeeded'
                    ELSE 'failed'
                  END
                ),
                'job', json_object(
                  'jobId', json_extract(result_json, '$.data.jobId'),
                  'workspaceId', json_extract(inspection_json, '$.normalizedArguments.workspaceId'),
                  'generation', json_extract(inspection_json, '$.normalizedArguments.generation')
                )
              )
            )
            WHERE tool_name IN ('workspace_execute_argv','workspace_job')
              AND result_json IS NOT NULL
              AND json_extract(result_json, '$.semantic') IS NULL
              AND json_type(result_json, '$.data.jobId') = 'text'
              AND json_type(inspection_json, '$.normalizedArguments.workspaceId') = 'text'
              AND json_type(inspection_json, '$.normalizedArguments.generation') = 'integer';
        `,
  },
  {
    id: 44,
    name: 'Project legacy SSH shell results into typed execution semantics',
    check: async (db: Database): Promise<boolean> => await tableExists(db, 'agent_tool_calls'),
    sql: `
            UPDATE agent_tool_calls
            SET result_json = json_set(
              result_json,
              '$.semantic',
              json_object(
                'kind', 'execution',
                'target', json_object(
                  'target', 'ssh',
                  'id', COALESCE(
                    json_extract(inspection_json, '$.target.id'),
                    CAST(json_extract(inspection_json, '$.normalizedArguments.connectionId') AS TEXT)
                  )
                ),
                'status', CASE
                  WHEN json_extract(result_json, '$.outcome') = 'unknown' THEN 'unknown'
                  WHEN json_extract(result_json, '$.ok') = 1
                    AND json_extract(result_json, '$.verification.status') = 'verified' THEN 'succeeded'
                  ELSE 'failed'
                END
              )
            )
            WHERE tool_name = 'machine_execute_shell'
              AND result_json IS NOT NULL
              AND json_extract(result_json, '$.semantic') IS NULL;
        `,
  },
  {
    id: 45,
    name: 'Canonicalize legacy machine inspection targets as SSH',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'agent_tool_calls')) && (await tableExists(db, 'agent_approvals')),
    sql: `
            UPDATE agent_tool_calls
            SET inspection_json = json_set(
              inspection_json,
              '$.target.kind', 'ssh',
              '$.target.target', 'ssh',
              '$.target.id', COALESCE(
                json_extract(inspection_json, '$.target.id'),
                CAST(json_extract(inspection_json, '$.normalizedArguments.connectionId') AS TEXT)
              )
            )
            WHERE json_extract(inspection_json, '$.target.kind') = 'machine'
              AND COALESCE(
                json_extract(inspection_json, '$.target.id'),
                CAST(json_extract(inspection_json, '$.normalizedArguments.connectionId') AS TEXT)
              ) IS NOT NULL;

            UPDATE agent_approvals
            SET inspection_json = json_set(
              inspection_json,
              '$.target.kind', 'ssh',
              '$.target.target', 'ssh',
              '$.target.id', COALESCE(
                json_extract(inspection_json, '$.target.id'),
                CAST(json_extract(inspection_json, '$.normalizedArguments.connectionId') AS TEXT)
              )
            )
            WHERE inspection_json IS NOT NULL
              AND json_extract(inspection_json, '$.target.kind') = 'machine'
              AND COALESCE(
                json_extract(inspection_json, '$.target.id'),
                CAST(json_extract(inspection_json, '$.normalizedArguments.connectionId') AS TEXT)
              ) IS NOT NULL;
        `,
  },
];
