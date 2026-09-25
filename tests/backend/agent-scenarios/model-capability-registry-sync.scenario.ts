import assert from 'node:assert/strict';
import { resolveModelCapabilityDefaults } from '../../../packages/backend/src/modules/agent/ai/model-capability-resolver';
import { ModelCapabilityRegistryService } from '../../../packages/backend/src/modules/agent/ai/model-capability-registry.service';
import { parseModelsDevRegistry } from '../../../packages/backend/src/modules/agent/ai/model-capability-registry-source';
import { installRuntimeModelCapabilityRegistry } from '../../../packages/backend/src/modules/agent/ai/model-capability-registry-runtime';
import type {
  ModelCapabilityRegistryFetchResult,
  ModelCapabilityRegistryPersistedState,
  ModelCapabilityRegistrySourcePort,
  ModelCapabilityRegistryStorePort,
} from '../../../packages/backend/src/modules/agent/ai/model-capability-registry.port';
import { clock } from './scenario-fixtures';

export const modelCapabilityRegistrySyncScenario = async () => {
  const generatedAt = clock.nowUnixSeconds() - 60;
  const models = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [
      index === 0 ? 'sync-model' : `sync-model-${index}`,
      {
        limit: { context: 32_768 + index, output: 4_096 },
        tool_call: true,
        reasoning: index === 0,
        reasoning_options: index === 0 ? [{ type: 'effort', values: ['low', 'high'] }] : [],
        modalities: { input: index === 0 ? ['text', 'image', 'pdf'] : ['text'], output: ['text'] },
      },
    ]),
  );
  const versionedModels = {
    'global.anthropic.claude-sonnet-v1:0': {
      limit: { context: 111_111, output: 4_096 },
      tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
    },
    'bedrock/ap-south-1/global.anthropic.claude-sonnet-v1:0': {
      limit: { context: 222_222, output: 4_096 },
      tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
    },
    'ft:gpt-4o:org:custom': {
      limit: { context: 333_333, output: 4_096 },
      tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
    },
  };
  const deepseekModels = {
    'deepseek-v4.1-0731': {
      limit: { context: 444_444, output: 8_192 },
      tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
    },
    'deepseek-v4.2': {
      limit: { context: 555_555, output: 8_192 },
      tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
    },
  };
  const googleModels = {
    'gemini-3.8-flash': {
      limit: { context: 666_666, output: 8_192 },
      tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
    },
  };
  const snapshot = parseModelsDevRegistry(
    {
      openai: { models },
      amazon: { models: versionedModels },
      deepseek: { models: deepseekModels },
      google: { models: googleModels },
    },
    { generatedAt, sourceRevision: 'scenario-revision-1' },
  );
  assert.equal(snapshot.entries['sync-model']?.contextWindow, 32_768);
  assert.equal(snapshot.entries['sync-model']?.maxOutputTokens, 4_096);
  assert.equal(snapshot.entries['sync-model']?.supportsTools, true);
  assert.equal(snapshot.entries['sync-model']?.supportsImageInput, true);
  assert.equal(snapshot.entries['sync-model']?.supportsFileInput, true);
  assert.deepEqual(snapshot.entries['sync-model']?.reasoning?.supportedEfforts, ['low', 'high']);
  assert.equal(snapshot.entries['openai/sync-model']?.contextWindow, 32_768);

  class MemoryRegistryStore implements ModelCapabilityRegistryStorePort {
    state: ModelCapabilityRegistryPersistedState | null = {
      schemaVersion: 1,
      autoUpdate: false,
      snapshot: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
    };

    async load(): Promise<ModelCapabilityRegistryPersistedState | null> {
      return this.state ? structuredClone(this.state) : null;
    }

    async save(state: ModelCapabilityRegistryPersistedState): Promise<void> {
      this.state = structuredClone(state);
    }
  }

  class ScriptedRegistrySource implements ModelCapabilityRegistrySourcePort {
    result: ModelCapabilityRegistryFetchResult = { state: 'updated', snapshot };
    failure: Error | null = null;
    calls = 0;

    async fetch(): Promise<ModelCapabilityRegistryFetchResult> {
      this.calls += 1;
      if (this.failure) throw this.failure;
      return structuredClone(this.result);
    }
  }

  const store = new MemoryRegistryStore();
  const source = new ScriptedRegistrySource();
  const registry = new ModelCapabilityRegistryService(store, source, clock);

  try {
    await registry.initialize();
    assert.equal(registry.status().activeSource, 'builtin');
    assert.equal(registry.status().autoUpdate, false);

    const updated = await registry.refresh();
    assert.equal(updated.activeSource, 'updated');
    assert.equal(updated.entryCount, Object.keys(snapshot.entries).length);
    assert.equal(updated.sourceRevision, 'scenario-revision-1');
    assert.equal(source.calls, 1);

    const runtimeModel = resolveModelCapabilityDefaults('sync-model');
    assert.equal(runtimeModel?.contextWindow, 32_768);
    assert.deepEqual(runtimeModel?.reasoning?.supportedEfforts, ['low', 'high']);
    assert.equal(
      resolveModelCapabilityDefaults('custom:sync-model')?.contextWindow,
      32_768,
      'custom colon prefixes should resolve through the backend registry',
    );
    assert.equal(
      resolveModelCapabilityDefaults('CUSTOM/openai/SYNC_MODEL')?.contextWindow,
      32_768,
      'case and punctuation differences should resolve through the normalized suffix index',
    );
    assert.equal(
      resolveModelCapabilityDefaults('custom:global.anthropic.claude-sonnet-v1:0')?.contextWindow,
      111_111,
      'numeric model version suffixes must be preserved while custom prefixes are stripped',
    );
    assert.equal(
      resolveModelCapabilityDefaults('custom:bedrock/ap-south-1/global.anthropic.claude-sonnet-v1:0')?.contextWindow,
      222_222,
      'the most specific regional model id should win over its canonical suffix candidate',
    );
    assert.equal(
      resolveModelCapabilityDefaults('proxy:ft:gpt-4o:org:custom')?.contextWindow,
      333_333,
      'fine-tuned model identities must remain intact after prefix stripping',
    );
    assert.equal(
      resolveModelCapabilityDefaults('proxy:ft:gpt-4o:org:missing'),
      null,
      'an unknown fine-tune must not collapse to the base model',
    );
    assert.equal(
      resolveModelCapabilityDefaults('deepseek-v4.1')?.contextWindow,
      444_444,
      'an undated model family should resolve to its dated registry variant',
    );
    assert.equal(
      resolveModelCapabilityDefaults('deepseek-v4.2-0731')?.contextWindow,
      555_555,
      'a dated model id should fall back to the undated family entry when that exact version is absent',
    );
    assert.equal(
      resolveModelCapabilityDefaults('custom/deepseek_v4.1')?.contextWindow,
      444_444,
      'namespace stripping and normalized family matching should compose',
    );
    assert.equal(
      resolveModelCapabilityDefaults('deepseek-v4.1-lite'),
      null,
      'non-version product suffixes must not be stripped as family versions',
    );
    const geminiHigh = resolveModelCapabilityDefaults('gemini-3.8-flash-high');
    assert.equal(geminiHigh?.contextWindow, 666_666, 'reasoning preset variants should inherit the base model limits');
    assert.equal(geminiHigh?.reasoning?.defaultEffort, 'high');

    const enabled = await registry.setAutoUpdate(true);
    assert.equal(enabled.autoUpdate, true);
    assert.equal(store.state?.autoUpdate, true);

    source.failure = new Error('MODEL_REGISTRY_HTTP_503');
    await assert.rejects(() => registry.refresh(), /MODEL_REGISTRY_HTTP_503/);
    assert.equal(registry.status().lastErrorCode, 'MODEL_REGISTRY_HTTP_503');
    assert.equal(resolveModelCapabilityDefaults('sync-model')?.contextWindow, 32_768);
  } finally {
    registry.dispose();
    installRuntimeModelCapabilityRegistry(null);
  }

  class BlockingRegistrySource implements ModelCapabilityRegistrySourcePort {
    entered: (() => void) | null = null;
    release: (() => void) | null = null;

    async fetch(): Promise<ModelCapabilityRegistryFetchResult> {
      this.entered?.();
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
      return { state: 'updated', snapshot: structuredClone(snapshot) };
    }
  }

  const serializedStore = new MemoryRegistryStore();
  const blockingSource = new BlockingRegistrySource();
  const serializedRegistry = new ModelCapabilityRegistryService(serializedStore, blockingSource, clock);
  try {
    await serializedRegistry.initialize();
    let fetchEnteredResolve!: () => void;
    const fetchEntered = new Promise<void>((resolve) => {
      fetchEnteredResolve = resolve;
    });
    blockingSource.entered = fetchEnteredResolve;
    const refresh = serializedRegistry.refresh();
    await fetchEntered;

    let toggleSettled = false;
    const toggle = serializedRegistry.setAutoUpdate(true).finally(() => {
      toggleSettled = true;
    });
    await Promise.resolve();
    assert.equal(toggleSettled, false, 'auto-update mutation must wait behind an in-flight registry refresh');
    assert.equal(
      serializedStore.state?.autoUpdate,
      false,
      'queued auto-update must not persist before refresh completes',
    );

    blockingSource.release?.();
    await refresh;
    const toggled = await toggle;
    assert.equal(toggled.autoUpdate, true);
    assert.equal(serializedStore.state?.autoUpdate, true);
  } finally {
    serializedRegistry.dispose();
    installRuntimeModelCapabilityRegistry(null);
  }

  return [
    { name: 'synced_model_identifiers', value: Object.keys(snapshot.entries).length, unit: 'models' },
    { name: 'keeper_style_model_matches', value: 11, unit: 'cases' },
    { name: 'manual_refresh_calls', value: source.calls, unit: 'calls' },
    { name: 'registry_mutations_serialized', value: 1, unit: 'boolean' },
    { name: 'update_failure_preserved_snapshot', value: 1, unit: 'boolean' },
  ];
};
