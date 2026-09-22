import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteProviderRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-provider.repository';
import { parseRunDefinition } from '../../../packages/backend/src/infrastructure/agent/runtime/durable-state-decoders';
import { OpenAiProviderAdapter } from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider.adapter';
import { parseOpenAiCompatibleCapabilityMetadata } from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider-capability-metadata';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import {
  applyModelCapabilitySnapshot,
  deriveCapabilityOverrides,
  resolveModelCapabilityDefaults,
  resolveProviderModelConfig,
  snapshotProviderModelCapabilities,
} from '../../../packages/backend/src/modules/agent/ai/model-capability-resolver';
import type {
  PersistedProviderView,
  ProviderModelCapabilityObservation,
  ProviderView,
} from '../../../packages/backend/src/modules/agent/ai/model.types';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import { clock } from './scenario-fixtures';
import { ScriptedLanguageModel, StaticProviderRepository } from './scenario-benchmark-helpers';

export const providerLiveCapabilityAuthorityScenario = async () => {
  const registryOnly = resolveProviderModelConfig({ id: 'gpt-4o' });
  assert.equal(registryOnly.contextWindow, 128_000);
  assert.equal(registryOnly.maxOutputTokens, 16_384);
  assert.equal(registryOnly.capabilitySources.contextWindow, 'registry');
  assert.equal(registryOnly.capabilitySources.supportsImageInput, 'registry');

  const providerOnly: ProviderModelCapabilityObservation = {
    modelId: 'private-live-model',
    source: 'scenario-provider',
    sourceVersion: 'capabilities-v1',
    capabilities: {
      contextWindow: 64_000,
      maxOutputTokens: 8_000,
      supportsTools: false,
      supportsImageInput: true,
      reasoning: {
        supportedEfforts: ['low', 'high'],
        defaultEffort: 'low',
      },
    },
    updatedAt: clock.nowUnixSeconds(),
  };
  const providerOnlyResolved = resolveProviderModelConfig({ id: providerOnly.modelId }, providerOnly);
  assert.equal(providerOnlyResolved.contextWindow, 64_000);
  assert.equal(providerOnlyResolved.maxOutputTokens, 8_000);
  assert.equal(providerOnlyResolved.capabilitySources.contextWindow, 'provider');
  assert.equal(providerOnlyResolved.capabilitySources.supportsTools, 'provider');
  assert.equal(providerOnlyResolved.capabilitySources.reasoning, 'provider');

  const mixedObservation: ProviderModelCapabilityObservation = {
    modelId: 'gpt-4o',
    source: 'scenario-provider',
    sourceVersion: 'partial-v1',
    capabilities: { maxOutputTokens: 8_192 },
    updatedAt: clock.nowUnixSeconds(),
  };
  const mixed = resolveProviderModelConfig({ id: 'gpt-4o' }, mixedObservation);
  assert.equal(mixed.contextWindow, 128_000);
  assert.equal(mixed.maxOutputTokens, 8_192);
  assert.equal(mixed.supportsTools, true);
  assert.equal(mixed.capabilitySources.contextWindow, 'registry');
  assert.equal(mixed.capabilitySources.maxOutputTokens, 'provider');
  assert.equal(mixed.capabilitySources.supportsTools, 'registry');
  assert.ok(mixed.capabilityConflicts?.includes('maxOutputTokens'));

  const allThree = resolveProviderModelConfig(
    {
      id: 'gpt-4o',
      capabilityOverrides: {
        maxOutputTokens: 4_096,
        supportsTools: false,
      },
    },
    {
      ...mixedObservation,
      capabilities: { maxOutputTokens: 8_192, supportsTools: true },
    },
  );
  assert.equal(allThree.maxOutputTokens, 4_096);
  assert.equal(allThree.supportsTools, false);
  assert.equal(allThree.capabilitySources.maxOutputTokens, 'manual');
  assert.equal(allThree.capabilitySources.supportsTools, 'manual');
  assert.ok(allThree.capabilityConflicts?.includes('maxOutputTokens'));
  assert.ok(allThree.capabilityConflicts?.includes('supportsTools'));

  assert.deepEqual(
    deriveCapabilityOverrides(
      providerOnly.modelId,
      {
        contextWindow: providerOnlyResolved.contextWindow,
        maxOutputTokens: providerOnlyResolved.maxOutputTokens,
        supportsTools: providerOnlyResolved.supportsTools,
        supportsImageInput: providerOnlyResolved.supportsImageInput,
        supportsFileInput: providerOnlyResolved.supportsFileInput,
        reasoningEfforts: providerOnlyResolved.reasoningEfforts,
        defaultReasoningEffort: providerOnlyResolved.defaultReasoningEffort,
      },
      providerOnly,
    ),
    {},
    'Posting provider-derived effective values must not manufacture manual overrides',
  );
  assert.deepEqual(
    deriveCapabilityOverrides(
      providerOnly.modelId,
      {
        contextWindow: 48_000,
        maxOutputTokens: providerOnlyResolved.maxOutputTokens,
        supportsTools: providerOnlyResolved.supportsTools,
        supportsImageInput: providerOnlyResolved.supportsImageInput,
        supportsFileInput: providerOnlyResolved.supportsFileInput,
        reasoningEfforts: providerOnlyResolved.reasoningEfforts,
        defaultReasoningEffort: providerOnlyResolved.defaultReasoningEffort,
      },
      providerOnly,
    ),
    { contextWindow: 48_000 },
  );

  assert.ok(resolveModelCapabilityDefaults('gpt-5.6-sol-2026-09-18'));
  assert.equal(resolveModelCapabilityDefaults('gpt-5.6-sol-preview'), null);
  assert.equal(resolveModelCapabilityDefaults('proxy-gpt-4o'), null);
  assert.throws(() => resolveProviderModelConfig({ id: 'proxy-gpt-4o' }), /MODEL_CAPABILITY_INCOMPLETE/);

  const persisted: PersistedProviderView = {
    id: 'live-authority-provider',
    kind: 'openai-compatible',
    displayName: 'Live authority provider',
    baseUrl: 'http://scenario.invalid/v1',
    protocol: 'chat-completions',
    hasCredential: false,
    credentialRevision: 1,
    models: [{ id: providerOnly.modelId }],
    liveCapabilities: [],
    enabled: true,
    version: 7,
    createdAt: clock.nowUnixSeconds(),
    updatedAt: clock.nowUnixSeconds(),
  };
  const repository = new StaticProviderRepository(persisted);
  const v1Discovery = new ScriptedLanguageModel(
    [],
    [
      {
        id: providerOnly.modelId,
        liveCapabilityReport: {
          source: providerOnly.source,
          sourceVersion: providerOnly.sourceVersion,
          capabilities: providerOnly.capabilities,
        },
      },
    ],
  );
  const serviceV1 = new ProviderService(repository, v1Discovery, clock);
  const discoveredV1 = await serviceV1.discoverModels(1, persisted.id);
  assert.equal(discoveredV1[0]?.providerCapabilities?.sourceVersion, 'capabilities-v1');
  assert.equal(persisted.version, 7, 'Live capability refresh must not bump provider configurationVersion');
  const effectiveV1 = await serviceV1.get(1, persisted.id);
  assert.equal(effectiveV1.models[0]?.contextWindow, 64_000);
  assert.equal(effectiveV1.models[0]?.capabilitySources.contextWindow, 'provider');

  const frozen = snapshotProviderModelCapabilities(effectiveV1.models[0]!);
  const durableDefinition = parseRunDefinition(
    JSON.stringify({
      schemaVersion: 1,
      agentDefinitionId: 'scenario-agent',
      requiredModelCapabilities: [],
      model: {
        providerId: persisted.id,
        modelId: providerOnly.modelId,
        configurationVersion: persisted.version,
      },
      modelCapabilities: frozen,
      rootModelRoutes: [],
      approvalMode: 'ask',
      executionMode: 'execute',
      connectionIds: [],
      environment: null,
      policyRevision: 1,
      settingsRevision: 1,
    }),
  );
  assert.deepEqual(durableDefinition.modelCapabilities, frozen);

  const v2Discovery = new ScriptedLanguageModel(
    [],
    [
      {
        id: providerOnly.modelId,
        liveCapabilityReport: {
          source: providerOnly.source,
          sourceVersion: 'capabilities-v2',
          capabilities: {
            contextWindow: 96_000,
            maxOutputTokens: 12_000,
            supportsTools: true,
            supportsImageInput: false,
          },
        },
      },
    ],
  );
  const serviceV2 = new ProviderService(repository, v2Discovery, clock);
  await serviceV2.discoverModels(1, persisted.id);
  const effectiveV2 = await serviceV2.get(1, persisted.id);
  assert.equal(effectiveV2.models[0]?.contextWindow, 96_000);
  assert.equal(effectiveV2.models[0]?.providerCapabilities?.sourceVersion, 'capabilities-v2');
  assert.equal(persisted.version, 7);

  const frozenDuringRefresh = applyModelCapabilitySnapshot(effectiveV2.models[0]!, durableDefinition.modelCapabilities);
  assert.equal(frozenDuringRefresh.contextWindow, 64_000);
  assert.equal(frozenDuringRefresh.maxOutputTokens, 8_000);
  assert.equal(frozenDuringRefresh.supportsTools, false);
  assert.equal(frozenDuringRefresh.supportsImageInput, true);

  const genericDiscovery = new ProviderService(
    repository,
    new ScriptedLanguageModel([], [{ id: providerOnly.modelId, ownedBy: 'generic-compatible' }]),
    clock,
  );
  const genericResult = await genericDiscovery.discoverModels(1, persisted.id);
  assert.equal(genericResult[0]?.providerCapabilities?.sourceVersion, 'capabilities-v2');
  assert.equal(
    persisted.liveCapabilities[0]?.sourceVersion,
    'capabilities-v2',
    'Identifier-only /models discovery must not invent or erase capability observations',
  );

  const explicitMetadata = {
    schema_version: 1,
    context_window: 72_000,
    max_output_tokens: 9_000,
    supports_tools: true,
    supports_image_input: false,
    supports_file_input: true,
    supports_prompt_cache_key: true,
    reasoning: {
      supported_efforts: ['high', 'low'],
      default_effort: 'high',
      mandatory: false,
    },
  };
  const parsedExplicit = parseOpenAiCompatibleCapabilityMetadata(explicitMetadata, 'https://capabilities.example/v1');
  assert.deepEqual(parsedExplicit?.capabilities, {
    contextWindow: 72_000,
    maxOutputTokens: 9_000,
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: true,
    supportsPromptCacheKey: true,
    reasoning: {
      supportedEfforts: ['low', 'high'],
      defaultEffort: 'high',
      mandatory: false,
    },
  });
  assert.match(parsedExplicit?.source ?? '', /^openai-compatible:[A-Za-z0-9_-]{43}:\/models:nexus_capabilities$/);
  assert.match(parsedExplicit?.sourceVersion ?? '', /^schema-1:sha256:[A-Za-z0-9_-]{43}$/);
  const sameCapabilitiesOtherEndpoint = parseOpenAiCompatibleCapabilityMetadata(
    { ...explicitMetadata },
    'https://other-capabilities.example/v1',
  );
  assert.notEqual(
    sameCapabilitiesOtherEndpoint?.source,
    parsedExplicit?.source,
    'Capability authority source must be bound to the configured Provider endpoint',
  );
  assert.equal(
    sameCapabilitiesOtherEndpoint?.sourceVersion,
    parsedExplicit?.sourceVersion,
    'Capability revision must describe normalized capability content independently of endpoint identity',
  );
  assert.equal(
    parseOpenAiCompatibleCapabilityMetadata({ ...explicitMetadata }, 'https://capabilities.example/v1')?.sourceVersion,
    parsedExplicit?.sourceVersion,
    'Capability source revision must be deterministic for equivalent normalized metadata',
  );
  assert.notEqual(
    parseOpenAiCompatibleCapabilityMetadata(
      { ...explicitMetadata, max_output_tokens: 9_001 },
      'https://capabilities.example/v1',
    )?.sourceVersion,
    parsedExplicit?.sourceVersion,
    'Capability source revision must change when normalized capability content changes',
  );
  assert.equal(parseOpenAiCompatibleCapabilityMetadata(undefined, 'https://capabilities.example/v1'), undefined);
  for (const invalidMetadata of [
    { schema_version: 2, supports_tools: true },
    { schema_version: 1 },
    { schema_version: 1, context_window: 4_096, max_output_tokens: 8_192 },
    { schema_version: 1, supports_tools: 'yes' },
    { schema_version: 1, supports_tools: true, inferred_from_name: true },
    { schema_version: 1, reasoning: { supported_efforts: ['low', 'turbo'] } },
  ]) {
    assert.throws(
      () => parseOpenAiCompatibleCapabilityMetadata(invalidMetadata, 'https://capabilities.example/v1'),
      /PROVIDER_CAPABILITY_METADATA_INVALID/,
    );
  }

  const adapterProvider: ProviderView = {
    id: 'adapter-live-provider',
    kind: 'openai-compatible',
    displayName: 'Adapter live provider',
    baseUrl: 'https://capabilities.example/v1',
    protocol: 'chat-completions',
    hasCredential: true,
    credentialRevision: 3,
    models: [],
    enabled: true,
    version: 11,
    createdAt: 1,
    updatedAt: 1,
  };
  const adapter = new OpenAiProviderAdapter(
    { get: async () => adapterProvider },
    {
      withCredential: async <T>(
        _userId: number,
        _providerId: string,
        _credentialRevision: number,
        use: (credential: string | null) => Promise<T>,
      ) => use('scenario-key'),
    },
  );
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'explicit-live-model',
              owned_by: 'explicit-provider',
              nexus_capabilities: explicitMetadata,
            },
            {
              id: 'heuristic-only-model',
              owned_by: 'generic-compatible',
              context_length: 128_000,
              max_completion_tokens: 16_000,
              supported_parameters: ['tools', 'vision'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    const adapterDiscovery = await adapter.discoverModels(1, adapterProvider.id, new AbortController().signal);
    assert.equal(adapterDiscovery[0]?.id, 'explicit-live-model');
    assert.deepEqual(adapterDiscovery[0]?.liveCapabilityReport, parsedExplicit);
    assert.equal(adapterDiscovery[1]?.id, 'heuristic-only-model');
    assert.equal(
      adapterDiscovery[1]?.liveCapabilityReport,
      undefined,
      'Generic context/parameter fields must remain non-authoritative without nexus_capabilities',
    );

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'broken-live-model', nexus_capabilities: { schema_version: 1, supports_tools: 'yes' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    await assert.rejects(
      () => adapter.discoverModels(1, adapterProvider.id, new AbortController().signal),
      /PROVIDER_CAPABILITY_METADATA_INVALID/,
      'Malformed explicit provider capability metadata must fail discovery closed',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const endpointDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-provider-live-endpoint-'));
  const endpointDb = new DatabaseAdapter({
    dataDirectory: endpointDirectory,
    filename: 'provider-live-endpoint.sqlite',
    nodeEnv: 'test',
  });
  try {
    await endpointDb.initialize();
    await endpointDb.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'provider-user', 'unused')");
    const endpointRepository = new SqliteProviderRepository(endpointDb, {
      encrypt: (value) => `opaque:${value}`,
      decrypt: (value) => (value.startsWith('opaque:') ? value.slice('opaque:'.length) : value),
    });
    const knownProvider = await endpointRepository.create({
      id: 'endpoint-known-provider',
      userId: 1,
      kind: 'openai-compatible',
      displayName: 'Endpoint known provider',
      baseUrl: 'https://old-provider.example/v1',
      protocol: 'chat-completions',
      models: [{ id: 'gpt-4o' }],
      enabled: true,
      createdAt: clock.nowUnixSeconds(),
      updatedAt: clock.nowUnixSeconds(),
    });
    await endpointRepository.replaceLiveCapabilities(1, knownProvider.id, [
      {
        modelId: 'gpt-4o',
        source: 'old-provider-live',
        sourceVersion: 'old-live-v1',
        capabilities: { maxOutputTokens: 8_192 },
        updatedAt: clock.nowUnixSeconds(),
      },
    ]);
    const endpointService = new ProviderService(endpointRepository, new ScriptedLanguageModel([]), clock);
    const knownBefore = await endpointService.get(1, knownProvider.id);
    assert.equal(knownBefore.models[0]?.maxOutputTokens, 8_192);
    assert.equal(knownBefore.models[0]?.capabilitySources.maxOutputTokens, 'provider');
    const knownAfter = await endpointService.update(1, knownProvider.id, knownProvider.version, {
      kind: knownBefore.kind,
      displayName: knownBefore.displayName,
      baseUrl: 'https://new-provider.example/v1',
      protocol: knownBefore.protocol,
      models: knownBefore.models,
      enabled: knownBefore.enabled,
    });
    assert.equal(knownAfter.version, knownProvider.version + 1);
    assert.equal(knownAfter.models[0]?.maxOutputTokens, 16_384);
    assert.equal(knownAfter.models[0]?.capabilitySources.maxOutputTokens, 'registry');
    assert.equal(knownAfter.models[0]?.capabilityOverrides?.maxOutputTokens, undefined);
    assert.deepEqual((await endpointRepository.get(1, knownProvider.id))?.liveCapabilities, []);

    const privateProvider = await endpointRepository.create({
      id: 'endpoint-private-provider',
      userId: 1,
      kind: 'openai-compatible',
      displayName: 'Endpoint private provider',
      baseUrl: 'https://old-private.example/v1',
      protocol: 'chat-completions',
      models: [{ id: 'private-endpoint-model' }],
      enabled: true,
      createdAt: clock.nowUnixSeconds(),
      updatedAt: clock.nowUnixSeconds(),
    });
    await endpointRepository.replaceLiveCapabilities(1, privateProvider.id, [
      {
        modelId: 'private-endpoint-model',
        source: 'old-private-live',
        sourceVersion: 'old-private-v1',
        capabilities: { contextWindow: 32_000, maxOutputTokens: 4_000, supportsTools: true },
        updatedAt: clock.nowUnixSeconds(),
      },
    ]);
    const privateBefore = await endpointService.get(1, privateProvider.id);
    await assert.rejects(
      () =>
        endpointService.update(1, privateProvider.id, privateProvider.version, {
          kind: privateBefore.kind,
          displayName: privateBefore.displayName,
          baseUrl: 'https://new-private.example/v1',
          protocol: privateBefore.protocol,
          models: privateBefore.models,
          enabled: privateBefore.enabled,
        }),
      /MODEL_CAPABILITY_INCOMPLETE/,
      'Changing Provider endpoint must fail closed when a private model is only complete because of old live metadata',
    );
    const privatePersisted = await endpointRepository.get(1, privateProvider.id);
    assert.equal(privatePersisted?.baseUrl, privateProvider.baseUrl);
    assert.equal(privatePersisted?.version, privateProvider.version);
    assert.equal(privatePersisted?.liveCapabilities[0]?.sourceVersion, 'old-private-v1');
  } finally {
    await endpointDb.close().catch(() => undefined);
    fs.rmSync(endpointDirectory, { recursive: true, force: true });
  }

  return [
    { name: 'source_precedence_levels', value: 3, unit: 'sources' },
    { name: 'field_merge_cases', value: 5, unit: 'cases' },
    { name: 'provider_refreshes_without_config_version_bump', value: 2, unit: 'refreshes' },
    { name: 'durable_run_snapshots_survive_refresh', value: 1, unit: 'snapshots' },
    { name: 'explicit_provider_metadata_ingestions', value: 1, unit: 'reports' },
    { name: 'heuristic_provider_metadata_inferences', value: 0, unit: 'reports' },
    { name: 'malformed_provider_metadata_fail_closed', value: 1, unit: 'cases' },
    { name: 'endpoint_change_live_observation_resets', value: 1, unit: 'resets' },
    { name: 'private_model_endpoint_change_fail_closed', value: 1, unit: 'cases' },
  ];
};
