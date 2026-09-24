import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppStorageRepository } from '../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-storage.repository';
import { DatabaseAdapter } from '../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../packages/backend/src/modules/agent/agent.types';
import {
  AGENT_EXECUTION_POLICY_STORAGE_KEY,
  SUBAGENT_PROFILES_STORAGE_KEY,
} from '../../packages/backend/src/modules/agent/host/app-storage-ownership';
import type { AppIntentService } from '../../packages/backend/src/modules/agent/host/app-intent.service';
import type { AppStateRepositoryPort } from '../../packages/backend/src/modules/agent/host/app-state.repository.port';
import type { AppStorageSnapshot } from '../../packages/backend/src/modules/agent/host/app-storage-snapshot.port';
import { PluginDataManager } from '../../packages/backend/src/modules/agent/host/plugin-data-manager';
import type {
  PluginInstallRepositoryPort,
  PluginInstallationRecord,
  PluginVersionRecord,
} from '../../packages/backend/src/modules/agent/host/plugin-install.repository.port';

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-storage-ownership-'));
  const database = new DatabaseAdapter({ dataDirectory: directory, filename: 'ownership.sqlite', nodeEnv: 'test' });
  const scope: Scope = { userId: 1, appId: 'plugin.storage.owner' };
  const now = Math.floor(Date.now() / 1000);

  try {
    await database.initialize();
    await database.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'plugin-owner-user', 'not-used')",
    );
    await database.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', ?, ?)`,
      [scope.appId, now, now],
    );

    const storage = new SqliteAppStorageRepository(database);
    const execution = await storage.put(scope, AGENT_EXECUTION_POLICY_STORAGE_KEY, { host: 'execution-v1' }, null);
    await storage.put(scope, SUBAGENT_PROFILES_STORAGE_KEY, { host: 'subagent-v1' }, null);
    await storage.put(scope, 'plugin.preference', { plugin: 'v1' }, null);

    let installationStatus: PluginInstallationRecord['status'] = 'installed';
    const installation = (): PluginInstallationRecord =>
      ({
        userId: scope.userId,
        appId: scope.appId,
        version: '1.0.0',
        status: installationStatus,
      }) as PluginInstallationRecord;
    const repository = {
      getInstallation: async () => installation(),
      listInstallations: async () => [installation()],
      getVersion: async () => ({ status: 'installed' }) as PluginVersionRecord,
    } as unknown as PluginInstallRepositoryPort;
    const states = {
      get: async () => ({
        activeVersion: '1.0.0',
        desiredState: 'enabled',
        observedState: 'running',
      }),
    } as unknown as AppStateRepositoryPort;
    const manager = new PluginDataManager(repository, states, storage, {} as AppIntentService);

    const pluginSnapshot = await manager.capture(scope);
    assert.deepEqual(
      pluginSnapshot.entries.map((entry) => entry.key),
      ['plugin.preference'],
      'Plugin lifecycle snapshots must not expose Host-owned policy rows',
    );

    const latestExecution = await storage.put(
      scope,
      AGENT_EXECUTION_POLICY_STORAGE_KEY,
      { host: 'execution-v2' },
      execution.version,
    );
    const migratedValue = { plugin: 'migrated' };
    const migrated: AppStorageSnapshot = {
      entries: pluginSnapshot.entries.map((entry) => ({
        ...entry,
        value: migratedValue,
        bytes: bytesOf(migratedValue),
        version: entry.version + 1,
        updatedAt: now + 1,
      })),
      totalBytes: bytesOf(migratedValue),
    };
    await manager.restore(scope, migrated);

    const executionAfterMigration = await storage.get(scope, AGENT_EXECUTION_POLICY_STORAGE_KEY);
    assert.equal(executionAfterMigration?.version, latestExecution.version);
    assert.deepEqual(executionAfterMigration?.value, { host: 'execution-v2' });
    assert.deepEqual((await storage.get(scope, 'plugin.preference'))?.value, migratedValue);

    const reservedValue = { plugin: 'attempted-policy-write' };
    await assert.rejects(
      manager.restore(scope, {
        entries: [
          {
            key: AGENT_EXECUTION_POLICY_STORAGE_KEY,
            value: reservedValue,
            bytes: bytesOf(reservedValue),
            version: 1,
            updatedAt: now,
          },
        ],
        totalBytes: bytesOf(reservedValue),
      }),
      /APP_STORAGE_KEY_RESERVED/,
      'Plugin migrate output must not smuggle Host-owned keys back into AppStorage',
    );

    await assert.rejects(
      manager.frontendRpc(scope.userId, scope.appId, {
        version: '1.0.0',
        method: 'storage.get',
        params: { key: SUBAGENT_PROFILES_STORAGE_KEY },
      }),
      /APP_STORAGE_KEY_RESERVED/,
      'Plugin Frontend SDK must not read Host-owned policy keys',
    );

    const backendRuntimeSource = fs.readFileSync(
      new URL(
        '../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter.ts',
        import.meta.url,
      ),
      'utf8',
    );
    assert(
      backendRuntimeSource.includes('assertPluginOwnedAppStorageKey(message.key);'),
      'Plugin Backend storage RPC must enforce the same reserved-key ownership boundary',
    );

    installationStatus = 'removed';
    await manager.deleteData(scope.userId, scope.appId);
    assert.equal(await storage.get(scope, 'plugin.preference'), null);
    assert(await storage.get(scope, AGENT_EXECUTION_POLICY_STORAGE_KEY));
    assert(await storage.get(scope, SUBAGENT_PROFILES_STORAGE_KEY));

    const [removedView] = await manager.listInstallations(scope.userId);
    assert.equal(removedView?.retainedDataEntries, 0, 'Host policy rows are not Plugin retained data');
    assert.equal(removedView?.retainedDataBytes, 0);

    process.stdout.write('agent plugin storage ownership regression: PASS\n');
  } finally {
    await database.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
