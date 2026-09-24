import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalModelCapabilityRegistryStore } from '../../packages/backend/src/infrastructure/agent/providers/model-capability-registry.adapter';
import type { ModelCapabilityRegistryPersistedState } from '../../packages/backend/src/modules/agent/ai/model-capability-registry.port';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const read = async (relativePath: string): Promise<string> => readFile(path.join(root, relativePath), 'utf8');

const main = async (): Promise<void> => {
  const workspace = await read('packages/frontend/src/features/agent/settings/WorkspaceRuntimeSettings.vue');
  assert(workspace.includes('let detailsGeneration = 0;'));
  assert(workspace.includes('const generation = ++detailsGeneration;'));
  assert(workspace.includes('if (generation !== detailsGeneration || !props.availability.available) return;'));
  assert(workspace.includes('if (generation !== detailsGeneration) return;'));
  assert(workspace.includes('if (generation === detailsGeneration) loading.value = false;'));

  const providers = await read('packages/frontend/src/features/agent/settings/ModelProviderSettings.vue');
  assert(providers.includes('let modelRegistryGeneration = 0;'));
  assert(
    providers.split('const generation = ++modelRegistryGeneration;').length - 1 >= 3,
    'initial GET, manual refresh, and auto-update mutation must each invalidate older registry loads',
  );
  assert(
    providers.includes('if (generation === modelRegistryGeneration) modelRegistryStatus.value = status;'),
    'only the latest registry request may commit status',
  );

  const service = await read('packages/backend/src/modules/agent/ai/model-capability-registry.service.ts');
  assert(service.includes('private mutationTail: Promise<void> = Promise.resolve();'));
  assert(service.includes('return this.enqueueMutation(async () => {'));
  assert(service.includes('this.refreshPromise = this.enqueueMutation(() => this.refreshInternal()).finally(() => {'));
  assert(service.includes('private enqueueMutation<T>(action: () => Promise<T>): Promise<T>'));

  const adapter = await read(
    'packages/backend/src/infrastructure/agent/providers/model-capability-registry.adapter.ts',
  );
  assert(adapter.includes('randomUUID'));
  assert(adapter.includes('tmp-${process.pid}-${randomUUID()}'));

  const directory = await mkdtemp(path.join(tmpdir(), 'nexus-model-registry-'));
  try {
    const store = new LocalModelCapabilityRegistryStore(directory);
    const base: ModelCapabilityRegistryPersistedState = {
      schemaVersion: 1,
      autoUpdate: false,
      snapshot: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
    };
    await Promise.all([
      store.save({ ...base, autoUpdate: true, lastAttemptAt: 11 }),
      store.save({ ...base, autoUpdate: false, lastAttemptAt: 22 }),
    ]);
    const persisted = await store.load();
    assert(persisted, 'a concurrent save must leave a readable registry state');
    assert(
      persisted.lastAttemptAt === 11 || persisted.lastAttemptAt === 22,
      'the final file must be one complete save, not a corrupted/interleaved state',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  process.stdout.write('settings async generation regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
