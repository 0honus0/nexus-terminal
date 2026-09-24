import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { JsonValue, Scope } from '../../packages/backend/src/modules/agent/agent.types';
import type { AppStateRepositoryPort } from '../../packages/backend/src/modules/agent/host/app-state.repository.port';
import type { AppStoragePort, AppStorageRecord } from '../../packages/backend/src/modules/agent/host/app-storage.port';
import type {
  AppStorageSnapshot,
  AppStorageSnapshotPort,
} from '../../packages/backend/src/modules/agent/host/app-storage-snapshot.port';
import type { AppIntentService } from '../../packages/backend/src/modules/agent/host/app-intent.service';
import { PluginDataManager } from '../../packages/backend/src/modules/agent/host/plugin-data-manager';
import type { PluginInstallRepositoryPort } from '../../packages/backend/src/modules/agent/host/plugin-install.repository.port';

const bytesOf = (value: JsonValue): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const main = async (): Promise<void> => {
  const scope: Scope = { userId: 1, appId: 'plugin.upgrade.storage-fence' };
  let acceptNewRuns = true;
  const state = {
    activeVersion: '1.0.0',
    desiredState: 'enabled',
    observedState: 'running',
    acceptNewRuns,
  };
  const states = {
    get: async () => ({ ...state, acceptNewRuns }),
  } as unknown as AppStateRepositoryPort;
  const repository = {
    getInstallation: async () => ({ status: 'installed', version: '1.0.0' }),
    getVersion: async () => ({ status: 'installed' }),
  } as unknown as PluginInstallRepositoryPort;

  const entries = new Map<string, AppStorageRecord>();
  let version = 0;
  let putCount = 0;
  let captureCount = 0;
  let putEnteredResolve: (() => void) | undefined;
  let releasePutResolve: (() => void) | undefined;
  const putEntered = new Promise<void>((resolve) => {
    putEnteredResolve = resolve;
  });
  const releasePut = new Promise<void>((resolve) => {
    releasePutResolve = resolve;
  });

  const storage = {
    get: async (_scope: Scope, key: string) => entries.get(key) ?? null,
    put: async (_scope: Scope, key: string, value: JsonValue, expectedVersion: number | null) => {
      putCount += 1;
      if (putCount === 1) {
        putEnteredResolve?.();
        await releasePut;
      }
      const current = entries.get(key);
      assert.equal(current?.version ?? null, expectedVersion);
      const next: AppStorageRecord = {
        key,
        value,
        bytes: bytesOf(value),
        version: ++version,
        updatedAt: version,
      };
      entries.set(key, next);
      return next;
    },
    delete: async () => false,
    clear: async () => undefined,
    stats: async () => ({ entryCount: entries.size, totalBytes: 0 }),
    capture: async (): Promise<AppStorageSnapshot> => {
      captureCount += 1;
      const snapshotEntries = [...entries.values()].map((entry) => ({ ...entry }));
      return {
        entries: snapshotEntries,
        totalBytes: snapshotEntries.reduce((total, entry) => total + entry.bytes, 0),
      };
    },
    restore: async (_scope: Scope, snapshot: AppStorageSnapshot) => {
      entries.clear();
      for (const entry of snapshot.entries) entries.set(entry.key, { ...entry });
    },
  } as AppStoragePort & AppStorageSnapshotPort;

  const manager = new PluginDataManager(repository, states, storage, {} as AppIntentService);

  const write = manager.frontendRpc(scope.userId, scope.appId, {
    version: '1.0.0',
    method: 'storage.put',
    params: { key: 'plugin.value', value: 'before-fence', expectedVersion: null },
    operationId: '11111111-1111-4111-8111-111111111111',
  });
  await putEntered;

  acceptNewRuns = false;
  const migrate = manager.migrateStorage(scope, async (snapshot) => snapshot);
  await Promise.resolve();
  assert.equal(captureCount, 0, 'migration capture must wait for an already-admitted frontend mutation');

  releasePutResolve?.();
  await write;
  const rollbackSnapshot = await migrate;
  assert.deepEqual(
    rollbackSnapshot.entries.map((entry) => [entry.key, entry.value]),
    [['plugin.value', 'before-fence']],
    'migration snapshot must include the mutation that entered before the draining fence',
  );
  assert.deepEqual((await storage.get(scope, 'plugin.value'))?.value, 'before-fence');

  await assert.rejects(
    manager.frontendRpc(scope.userId, scope.appId, {
      version: '1.0.0',
      method: 'storage.put',
      params: { key: 'plugin.value', value: 'after-fence', expectedVersion: 1 },
      operationId: '22222222-2222-4222-8222-222222222222',
    }),
    /AGENT_APP_DRAINING/,
    'frontend mutations admitted after the upgrade fence must fail before storage side effects',
  );
  assert.equal(putCount, 1);

  const coordinatorSource = fs.readFileSync(
    new URL('../../packages/backend/src/modules/agent/host/plugin-package-install-coordinator.ts', import.meta.url),
    'utf8',
  );
  assert(
    coordinatorSource.indexOf('await this.runtimeLifecycle.dispose(scope, oldPlugin);') <
      coordinatorSource.indexOf('snapshot = await this.data.migrateStorage(scope'),
    'old backend must be disposed before migration captures AppStorage',
  );

  const runtimeSource = fs.readFileSync(
    new URL(
      '../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert(
    runtimeSource.includes('const instance = this.start(scope, plugin, false);') &&
      runtimeSource.includes("message.kind !== 'storage.get' && (!this.allowHostMutations || this.closing)"),
    'migration backend process must not mutate live AppStorage while transforming the supplied snapshot',
  );

  process.stdout.write('agent plugin upgrade storage fence regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
