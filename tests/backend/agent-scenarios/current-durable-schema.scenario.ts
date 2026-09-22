import assert from 'node:assert/strict';
import { decodePersistedProviderModels } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-provider.repository';

export const currentDurableSchemaScenario = async () => {
  const canonicalModels = JSON.stringify([
    {
      id: 'scenario-model',
      capabilityOverrides: {
        contextWindow: 32_768,
        maxOutputTokens: 4_096,
        supportsTools: true,
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium',
          mandatory: false,
        },
      },
    },
  ]);
  const decodedCanonicalModels = decodePersistedProviderModels(canonicalModels);
  assert.equal(decodedCanonicalModels[0]?.id, 'scenario-model');
  assert.throws(
    () =>
      decodePersistedProviderModels(
        JSON.stringify([
          {
            id: 'scenario-model',
            capabilityOverrides: {
              contextWindow: 32_768,
              maxOutputTokens: 4_096,
              supportsTools: true,
              reasoning: {
                supportedEfforts: ['low', 'medium', 'high'],
                defaultEffort: 'medium',
                mandatory: false,
                supportsMaxTokens: true,
              },
            },
          },
        ]),
      ),
    /AGENT_DURABLE_STATE_INVALID/,
    'removed reasoning metadata must fail closed instead of being normalized away',
  );
  assert.throws(
    () =>
      decodePersistedProviderModels(
        JSON.stringify([
          {
            id: 'scenario-model',
            contextWindow: 32_768,
            maxOutputTokens: 4_096,
            supportsTools: true,
          },
        ]),
      ),
    /AGENT_DURABLE_STATE_INVALID/,
    'unreleased flat provider capability schema must not remain as a runtime compatibility shim',
  );

  return [
    { name: 'provider_removed_runtime_shims', value: 0, unit: 'branches' },
    { name: 'provider_removed_shape_rejections', value: 2, unit: 'cases' },
  ];
};
