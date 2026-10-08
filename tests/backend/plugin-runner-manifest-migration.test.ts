import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runMigrations } from '../../packages/backend/src/infrastructure/database/sqlite-migrations';
import { decodePersistedAppManifest } from '../../packages/backend/src/infrastructure/agent/plugins/persisted-app-manifest-decoder';
import { AGENT_CAPABILITIES } from '../../packages/backend/src/modules/agent/host/capability.types';
import { CapabilityRegistry } from '../../packages/backend/src/modules/agent/host/capability-registry';

const manifest = {
  schemaVersion: 1,
  id: 'nexus.agent',
  version: '1.0.0',
  displayName: 'Nexus Agent',
  sdkVersion: '1.0.0',
  nexus: { minVersion: '1.0.0', maxVersion: '1.99.99' },
  capabilities: [],
  intents: [],
};

for (const tables of [
  ['agent_plugin_versions', 'agent_plugin_stages'],
  ['agent_plugin_versions'],
  ['agent_plugin_stages'],
  [],
]) {
  test(`upgrade removes persisted Runner targets with tables: ${tables.join(', ') || 'none'}`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER);
        INSERT INTO migrations (id, name) VALUES (58, 'Previously upgraded');
      `);
      const legacy = JSON.stringify({
        ...manifest,
        targets: {
          frontend: { entry: 'frontend/index.js' },
          backend: { entry: 'backend/index.mjs' },
          runner: { entry: 'runner/index.mjs' },
        },
      });
      assert.throws(() => decodePersistedAppManifest(legacy), /PLUGIN_MANIFEST_INVALID/);
      const current = JSON.stringify(manifest);
      for (const table of tables) {
        db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, manifest_json TEXT, package_hash TEXT);`);
        const insert = db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?)`);
        insert.run(1, legacy, 'signed-package-hash');
        insert.run(2, current, 'current-package-hash');
        insert.run(
          3,
          JSON.stringify({ ...manifest, targets: { runner: { entry: 'runner/index.mjs' } } }),
          'runner-only',
        );
        if (table === 'agent_plugin_stages') insert.run(4, null, 'unverified-stage');
      }

      await runMigrations(db);

      for (const table of tables) {
        const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Array<{
          id: number;
          manifest_json: string | null;
          package_hash: string;
        }>;
        assert.deepEqual(decodePersistedAppManifest(rows[0].manifest_json!).targets, {
          frontend: { entry: 'frontend/index.js' },
          backend: { entry: 'backend/index.mjs' },
        });
        assert.equal(rows[0].package_hash, 'signed-package-hash');
        assert.equal(rows[1].manifest_json, current);
        assert.deepEqual(decodePersistedAppManifest(rows[2].manifest_json!).targets, {});
        if (table === 'agent_plugin_stages') assert.equal(rows[3].manifest_json, null);
      }
      assert.equal(db.prepare('SELECT MAX(id) AS id FROM migrations').get()?.id, 64);
      const before = tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
      await runMigrations(db);
      assert.deepEqual(
        tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()),
        before,
      );
    } finally {
      db.close();
    }
  });
}

for (const previousVersion of [58, 60]) {
  test(`upgrade from ${previousVersion} migrates released Workspace manifests and grants`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER);
        INSERT INTO migrations (id, name) VALUES (${previousVersion}, 'Previously upgraded');
        CREATE TABLE agent_plugin_versions (manifest_json TEXT NOT NULL);
        CREATE TABLE agent_plugin_stages (manifest_json TEXT);
        CREATE TABLE agent_app_grants (capability TEXT, schema_version INTEGER, scope_json TEXT, granted_at INTEGER);
        CREATE TABLE agent_delegations (id INTEGER PRIMARY KEY, grants_json TEXT NOT NULL);
      `);
      const legacy = {
        ...manifest,
        capabilities: [...AGENT_CAPABILITIES, 'workspace.manage'],
        ...(previousVersion === 58 ? { targets: { runner: { entry: 'runner/index.mjs' } } } : {}),
      };
      assert.throws(() => decodePersistedAppManifest(JSON.stringify(legacy)), /PLUGIN_MANIFEST_INVALID/);
      const scopes = [
        { kind: 'targets', targets: { workspace: { mode: 'all' }, ssh: { mode: 'ids', ids: ['connection-1'] } } },
        { kind: 'targets', targets: { workspace: { mode: 'all' } } },
      ];
      const delegated = scopes.map((scope) => ({ capability: 'file.read', schemaVersion: 2, scope }));
      const retired = { capability: 'workspace.manage', schemaVersion: 2, scope: { kind: 'global' } };
      for (const table of ['agent_plugin_versions', 'agent_plugin_stages']) {
        db.prepare(`INSERT INTO ${table} VALUES (?)`).run(JSON.stringify(legacy));
        db.prepare(`INSERT INTO ${table} VALUES (?)`).run(
          JSON.stringify({ ...manifest, capabilities: ['workspace.manage'] }),
        );
      }
      db.exec('INSERT INTO agent_plugin_stages VALUES (NULL)');
      const insertGrant = db.prepare('INSERT INTO agent_app_grants VALUES (?, 2, ?, 123)');
      insertGrant.run('workspace.manage', JSON.stringify(retired.scope));
      insertGrant.run('file.read', JSON.stringify(scopes[0]));
      insertGrant.run('file.write', JSON.stringify(scopes[1]));
      insertGrant.run('browser.read', '{"kind":"global"}');
      const insertDelegation = db.prepare('INSERT INTO agent_delegations VALUES (?, ?)');
      insertDelegation.run(1, JSON.stringify([delegated[0], retired]));
      insertDelegation.run(2, JSON.stringify([delegated[1]]));
      insertDelegation.run(3, JSON.stringify([retired]));

      await runMigrations(db);

      for (const table of ['agent_plugin_versions', 'agent_plugin_stages']) {
        const rows = db.prepare(`SELECT manifest_json FROM ${table}`).all() as Array<{ manifest_json: string | null }>;
        assert.deepEqual(decodePersistedAppManifest(rows[0].manifest_json!).capabilities, [...AGENT_CAPABILITIES]);
        assert.deepEqual(decodePersistedAppManifest(rows[1].manifest_json!).capabilities, []);
        if (table === 'agent_plugin_stages') assert.equal(rows[2].manifest_json, null);
      }
      const registry = new CapabilityRegistry();
      const grants = db.prepare('SELECT * FROM agent_app_grants').all();
      assert.equal(grants.length, 3);
      assert.equal(
        grants.every((row) => row.granted_at === 123),
        true,
      );
      assert.deepEqual(registry.parseScope('file.read', JSON.parse(grants[0].scope_json as string)), {
        kind: 'targets',
        targets: { ssh: { mode: 'ids', ids: ['connection-1'] } },
      });
      assert.deepEqual(registry.parseScope('file.write', JSON.parse(grants[1].scope_json as string)), {
        kind: 'targets',
        targets: {},
      });
      const delegations = db.prepare('SELECT grants_json FROM agent_delegations ORDER BY id').all();
      assert.deepEqual(JSON.parse(delegations[0].grants_json as string), [
        { ...delegated[0], scope: { kind: 'targets', targets: { ssh: scopes[0].targets.ssh } } },
      ]);
      assert.deepEqual(JSON.parse(delegations[1].grants_json as string), [
        { ...delegated[1], scope: { kind: 'targets', targets: {} } },
      ]);
      assert.deepEqual(JSON.parse(delegations[2].grants_json as string), []);
    } finally {
      db.close();
    }
  });
}
