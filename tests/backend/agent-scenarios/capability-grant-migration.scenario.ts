import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../../packages/backend/src/infrastructure/database/sqlite-migrations';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolResult } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';

export const capabilityGrantMigrationScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-capability-grant-migration-'));
  const db = new DatabaseSync(path.join(directory, 'grant-migration.sqlite'));
  try {
    db.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO migrations (id, name, applied_at) VALUES (34, 'pre-capability-v2', 1800000000);

      CREATE TABLE agent_app_grants (
        user_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        scope_json TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, app_id, capability)
      );
      INSERT INTO agent_app_grants VALUES
        (1, 'workspace-only', 'workspace.read', 1, '{"targetSelection":"all-except-denylist"}', 10),
        (1, 'ssh-only', 'machine.files.read', 1, '{"targetSelection":"all-except-denylist"}', 11),
        (1, 'both', 'workspace.read', 1, '{"targetSelection":"all-except-denylist"}', 12),
        (1, 'both', 'machine.files.read', 1, '{"targetSelection":"all-except-denylist"}', 13),
        (1, 'workspace-write', 'workspace.write', 1, '{"targetSelection":"all-except-denylist"}', 14),
        (1, 'global', 'artifacts.read', 1, '{}', 15),
        (1, 'workspace-shell', 'workspace.execute', 1, '{}', 16),
        (1, 'ssh-shell', 'machine.shell.execute', 1, '{}', 17),
        (1, 'both-shell', 'workspace.execute', 1, '{}', 18),
        (1, 'both-shell', 'machine.shell.execute', 1, '{}', 19);

      CREATE TABLE agent_delegations (
        id TEXT PRIMARY KEY,
        capabilities_json TEXT NOT NULL
      );
      INSERT INTO agent_delegations VALUES (
        'legacy-delegation',
        '["workspace.read","machine.files.read","workspace.write","workspace.execute","machine.shell.execute","artifacts.read"]'
      );

      CREATE TABLE agent_plugin_versions (
        app_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_json TEXT NOT NULL
      );
      INSERT INTO agent_plugin_versions VALUES (
        'legacy.plugin',
        '1.0.0',
        '{"capabilities":["workspace.read","machine.files.write","workspace.execute","machine.shell.execute","artifacts.read"]}'
      );

      CREATE TABLE agent_plugin_stages (
        id TEXT PRIMARY KEY,
        manifest_json TEXT
      );
      INSERT INTO agent_plugin_stages VALUES (
        'legacy-stage',
        '{"capabilities":["machine.files.read","workspace.write","workspace.execute"]}'
      );

      CREATE TABLE agent_tool_calls (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        inspection_json TEXT NOT NULL,
        result_json TEXT
      );
      INSERT INTO agent_tool_calls VALUES (
        'legacy-workspace-shell',
        'workspace_execute_argv',
        '{"normalizedArguments":{"workspaceId":"legacy-workspace","generation":7},"target":{"kind":"workspace","target":"workspace","id":"legacy-workspace"}}',
        '{"ok":true,"summary":"accepted","data":{"jobId":"job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","workspaceId":"legacy-workspace","generation":7,"status":"running"},"artifactRefs":[],"truncated":false,"outcome":"confirmed","verification":{"status":"unverified","summary":"pending","evidenceRefs":[]}}'
      );
      INSERT INTO agent_tool_calls VALUES (
        'legacy-ssh-shell',
        'machine_execute_shell',
        '{"normalizedArguments":{"connectionId":42},"target":{"kind":"ssh","target":"ssh","id":"42"}}',
        '{"ok":true,"summary":"done","data":{"exitCode":0},"artifactRefs":[],"truncated":false,"outcome":"confirmed","verification":{"status":"verified","summary":"done","evidenceRefs":[]}}'
      );
    `);

    await runMigrations(db);

    const grants = db
      .prepare(
        'SELECT app_id, capability, schema_version, scope_json FROM agent_app_grants ORDER BY app_id, capability',
      )
      .all() as Array<{ app_id: string; capability: string; schema_version: number; scope_json: string }>;
    assert.equal(
      grants.every((grant) => grant.schema_version === 2),
      true,
    );
    const scopeFor = (appId: string, capability: string): JsonValue => {
      const row = grants.find((grant) => grant.app_id === appId && grant.capability === capability);
      assert.ok(row, `missing migrated grant ${appId}/${capability}`);
      return JSON.parse(row.scope_json) as JsonValue;
    };
    assert.deepEqual(scopeFor('workspace-only', 'file.read'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('ssh-only', 'file.read'), {
      kind: 'targets',
      targets: { ssh: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('both', 'file.read'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' }, ssh: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('workspace-write', 'file.write'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('global', 'artifacts.read'), { kind: 'global' });
    assert.deepEqual(scopeFor('workspace-shell', 'shell.execute'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('ssh-shell', 'shell.execute'), {
      kind: 'targets',
      targets: { ssh: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('both-shell', 'shell.execute'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' }, ssh: { mode: 'all' } },
    });

    const delegation = db.prepare("SELECT grants_json FROM agent_delegations WHERE id='legacy-delegation'").get() as {
      grants_json: string;
    };
    const delegatedGrants = JSON.parse(delegation.grants_json) as Array<{
      capability: string;
      schemaVersion: number;
      scope: JsonValue;
    }>;
    assert.deepEqual(
      delegatedGrants.map((grant) => grant.capability).sort(),
      ['artifacts.read', 'file.read', 'file.write', 'shell.execute'],
      'legacy Subagent file/shell authorities must collapse to canonical delegated capabilities',
    );
    for (const grant of delegatedGrants.filter((candidate) => candidate.capability.startsWith('file.'))) {
      assert.equal(grant.schemaVersion, 2);
      assert.deepEqual(grant.scope, {
        kind: 'targets',
        targets: { workspace: { mode: 'all' } },
      });
    }
    const delegatedShell = delegatedGrants.find((grant) => grant.capability === 'shell.execute');
    assert.ok(delegatedShell);
    assert.equal(delegatedShell.schemaVersion, 2);
    assert.deepEqual(delegatedShell.scope, {
      kind: 'targets',
      targets: { workspace: { mode: 'all' }, ssh: { mode: 'all' } },
    });

    const versionManifest = JSON.parse(
      (
        db.prepare("SELECT manifest_json FROM agent_plugin_versions WHERE app_id='legacy.plugin'").get() as {
          manifest_json: string;
        }
      ).manifest_json,
    ) as { capabilities: string[] };
    assert.deepEqual(versionManifest.capabilities, ['artifacts.read', 'file.read', 'file.write', 'shell.execute']);
    const stageManifest = JSON.parse(
      (
        db.prepare("SELECT manifest_json FROM agent_plugin_stages WHERE id='legacy-stage'").get() as {
          manifest_json: string;
        }
      ).manifest_json,
    ) as { capabilities: string[] };
    assert.deepEqual(stageManifest.capabilities, ['file.read', 'file.write', 'shell.execute']);

    const migratedWorkspaceResult = JSON.parse(
      (
        db.prepare("SELECT result_json FROM agent_tool_calls WHERE id='legacy-workspace-shell'").get() as {
          result_json: string;
        }
      ).result_json,
    ) as ToolResult;
    assert.deepEqual(migratedWorkspaceResult.semantic, {
      kind: 'execution',
      target: { target: 'workspace', id: 'legacy-workspace' },
      status: 'running',
      job: {
        jobId: 'job-' + 'a'.repeat(64),
        workspaceId: 'legacy-workspace',
        generation: 7,
      },
    });
    const migratedSshResult = JSON.parse(
      (
        db.prepare("SELECT result_json FROM agent_tool_calls WHERE id='legacy-ssh-shell'").get() as {
          result_json: string;
        }
      ).result_json,
    ) as ToolResult;
    assert.deepEqual(migratedSshResult.semantic, {
      kind: 'execution',
      target: { target: 'ssh', id: '42' },
      status: 'succeeded',
    });

    return [
      { name: 'capability_grant_migration_schema_version', value: 2, unit: 'version' },
      { name: 'capability_grant_migration_workspace_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_ssh_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_shell_workspace_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_shell_ssh_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_shell_combined', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_execution_semantics', value: 2, unit: 'results' },
      { name: 'capability_grant_migration_widened_scopes', value: 0, unit: 'cases' },
    ];
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
