import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBackupSnapshotAdapter } from '../../packages/backend/src/infrastructure/backup/sqlite-backup-snapshot.adapter';
import { DatabaseAdapter } from '../../packages/backend/src/infrastructure/database/database.adapter';
import { AesGcmSecretCipher } from '../../packages/backend/src/infrastructure/security/aes-gcm-secret-cipher';

const SOURCE_KEY = '11'.repeat(32);
const TARGET_KEY = '22'.repeat(32);

const insertUser = (db: DatabaseAdapter) =>
  db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'backup-user', 'not-used')");

const insertApp = (db: DatabaseAdapter, appId: string, now: number) =>
  db.execute(
    `INSERT INTO agent_apps (
       user_id, app_id, active_version, desired_state, observed_state, health_reason,
       policy_revision, running_count, approval_count, budget_request_count,
       accept_new_runs, version, created_at, updated_at
     ) VALUES (1, ?, '1.0.0', 'enabled', 'running', NULL, 1, 0, 0, 0, 1, 1, ?, ?)`,
    [appId, now, now],
  );

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-full-backup-'));
  const sourceDirectory = path.join(root, 'source');
  const targetDirectory = path.join(root, 'target');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(targetDirectory, { recursive: true });

  const sourceDb = new DatabaseAdapter({ dataDirectory: sourceDirectory, filename: 'source.sqlite', nodeEnv: 'test' });
  const targetDb = new DatabaseAdapter({ dataDirectory: targetDirectory, filename: 'target.sqlite', nodeEnv: 'test' });
  const sourceCipher = new AesGcmSecretCipher(SOURCE_KEY);
  const targetCipher = new AesGcmSecretCipher(TARGET_KEY);
  const sourceBackup = new SqliteBackupSnapshotAdapter(sourceDb, sourceCipher, sourceDirectory);
  const targetBackup = new SqliteBackupSnapshotAdapter(targetDb, targetCipher, targetDirectory);
  const now = 1_790_000_000;

  try {
    await sourceDb.initialize();
    await targetDb.initialize();
    await insertUser(sourceDb);
    await insertUser(targetDb);
    await insertApp(sourceDb, 'fixture.backup', now);
    await insertApp(targetDb, 'fixture.stale', now - 100);

    const sourceProviderCiphertext = sourceCipher.encrypt('source-provider-secret');
    const sourceIntegrationCiphertext = sourceCipher.encrypt('source-integration-secret');
    await sourceDb.execute(
      `INSERT INTO ai_providers (
         id, user_id, kind, display_name, base_url, protected_credential, credential_revision,
         models_json, endpoint_policy_json, enabled, version, created_at, updated_at
       ) VALUES ('provider-source', 1, 'openai-compatible', 'Source provider', 'https://example.invalid/v1', ?, 1,
                 '[]', '{}', 1, 1, ?, ?)`,
      [sourceProviderCiphertext, now, now],
    );
    await sourceDb.execute(
      `INSERT INTO agent_integrations (
         id, user_id, app_id, kind, configuration_json, protected_credential, credential_revision,
         schema_hash, enabled, version, created_at, updated_at
       ) VALUES ('integration-source', 1, 'fixture.backup', 'mcp', '{}', ?, 1, NULL, 1, 1, ?, ?)`,
      [sourceIntegrationCiphertext, now, now],
    );
    await sourceDb.execute(
      `INSERT INTO ai_artifacts (
         id, user_id, app_id, original_name, media_type, storage_key, sha256,
         size_bytes, reserved_bytes, status, retained, version, created_at, ready_at
       ) VALUES ('artifact-source', 1, 'fixture.backup', 'proof.txt', 'text/plain', 'abcdef', NULL,
                 14, 14, 'ready', 0, 1, ?, ?)`,
      [now, now],
    );
    await sourceDb.execute(
      `INSERT INTO agent_plugin_versions (
         app_id, version, package_hash, publisher_key_id, manifest_json, skill_files_json,
         status, installed_at, updated_at
       ) VALUES ('fixture.backup', '1.0.0', 'package-hash', 'publisher-key', '{}', '[]',
                 'installed', ?, ?)`,
      [now, now],
    );

    await targetDb.execute(
      `INSERT INTO ai_providers (
         id, user_id, kind, display_name, base_url, protected_credential, credential_revision,
         models_json, endpoint_policy_json, enabled, version, created_at, updated_at
       ) VALUES ('provider-stale', 1, 'openai-compatible', 'Stale provider', 'https://stale.invalid/v1', NULL, 1,
                 '[]', '{}', 1, 1, ?, ?)`,
      [now - 100, now - 100],
    );

    const sourceArtifact = path.join(sourceDirectory, 'agent', 'artifacts', 'objects', 'ab', 'abcdef');
    const sourcePlugin = path.join(
      sourceDirectory,
      'agent',
      'plugins',
      'fixture.backup',
      'versions',
      '1.0.0',
      '.nexus-package-hash',
    );
    fs.mkdirSync(path.dirname(sourceArtifact), { recursive: true });
    fs.mkdirSync(path.dirname(sourcePlugin), { recursive: true });
    fs.writeFileSync(sourceArtifact, 'artifact-proof\n');
    fs.writeFileSync(sourcePlugin, 'package-hash\n');
    fs.mkdirSync(path.join(sourceDirectory, 'agent'), { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'agent', 'model-capability-registry.json'), '{"cache":true}');

    const targetArtifact = path.join(targetDirectory, 'agent', 'artifacts', 'objects', 'st', 'stale');
    const targetPlugin = path.join(
      targetDirectory,
      'agent',
      'plugins',
      'fixture.stale',
      'versions',
      '9.9.9',
      '.nexus-package-hash',
    );
    fs.mkdirSync(path.dirname(targetArtifact), { recursive: true });
    fs.mkdirSync(path.dirname(targetPlugin), { recursive: true });
    fs.writeFileSync(targetArtifact, 'stale-artifact');
    fs.writeFileSync(targetPlugin, 'stale-package');
    fs.mkdirSync(path.join(targetDirectory, 'agent'), { recursive: true });
    fs.writeFileSync(path.join(targetDirectory, 'agent', 'model-capability-registry.json'), '{"targetCache":true}');

    const snapshot = await sourceBackup.capture();
    assert.equal(snapshot.tables.agent_apps?.length, 1);
    assert.equal(snapshot.tables.ai_providers?.length, 1);
    assert.equal(snapshot.tables.agent_integrations?.length, 1);
    assert(snapshot.files.some((file) => file.path === 'agent/artifacts/objects/ab/abcdef'));
    assert(
      snapshot.files.some((file) => file.path === 'agent/plugins/fixture.backup/versions/1.0.0/.nexus-package-hash'),
    );
    assert(!snapshot.files.some((file) => file.path.includes('model-capability-registry.json')));

    await targetBackup.restore(snapshot);

    assert.equal(
      await targetDb.queryOne<{ app_id: string }>("SELECT app_id FROM agent_apps WHERE app_id='fixture.stale'"),
      null,
    );
    assert(await targetDb.queryOne("SELECT app_id FROM agent_apps WHERE app_id='fixture.backup'"));
    assert.equal(await targetDb.queryOne("SELECT id FROM ai_providers WHERE id='provider-stale'"), null);

    const restoredProvider = await targetDb.queryOne<{ protected_credential: string }>(
      "SELECT protected_credential FROM ai_providers WHERE id='provider-source'",
    );
    const restoredIntegration = await targetDb.queryOne<{ protected_credential: string }>(
      "SELECT protected_credential FROM agent_integrations WHERE id='integration-source'",
    );
    assert(restoredProvider?.protected_credential);
    assert(restoredIntegration?.protected_credential);
    assert.notEqual(restoredProvider.protected_credential, sourceProviderCiphertext);
    assert.notEqual(restoredIntegration.protected_credential, sourceIntegrationCiphertext);
    assert.equal(targetCipher.decrypt(restoredProvider.protected_credential), 'source-provider-secret');
    assert.equal(targetCipher.decrypt(restoredIntegration.protected_credential), 'source-integration-secret');

    assert.equal(
      fs.readFileSync(path.join(targetDirectory, 'agent', 'artifacts', 'objects', 'ab', 'abcdef'), 'utf8'),
      'artifact-proof\n',
    );
    assert.equal(
      fs.readFileSync(
        path.join(targetDirectory, 'agent', 'plugins', 'fixture.backup', 'versions', '1.0.0', '.nexus-package-hash'),
        'utf8',
      ),
      'package-hash\n',
    );
    assert(!fs.existsSync(targetArtifact));
    assert(!fs.existsSync(targetPlugin));
    assert.equal(
      fs.readFileSync(path.join(targetDirectory, 'agent', 'model-capability-registry.json'), 'utf8'),
      '{"targetCache":true}',
    );

    await assert.rejects(
      targetBackup.restore({
        ...snapshot,
        files: [
          ...snapshot.files,
          { path: 'agent/model-capability-registry.json', contentBase64: Buffer.from('{}').toString('base64') },
        ],
      }),
      /备份包含不允许的文件路径/,
    );

    process.stdout.write('agent full backup regression: PASS\n');
  } finally {
    await Promise.all([sourceDb.close().catch(() => undefined), targetDb.close().catch(() => undefined)]);
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
