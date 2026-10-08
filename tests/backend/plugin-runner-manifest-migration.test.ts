import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runMigrations } from '../../packages/backend/src/infrastructure/database/sqlite-migrations';
import { decodePersistedAppManifest } from '../../packages/backend/src/infrastructure/agent/plugins/persisted-app-manifest-decoder';

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
      assert.equal(db.prepare('SELECT MAX(id) AS id FROM migrations').get()?.id, 60);
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
