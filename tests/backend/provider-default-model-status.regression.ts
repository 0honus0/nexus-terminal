import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveProviderDefaultModelStatus } from '../../packages/frontend/src/features/agent/settings/provider-default-model-status';

const status = (
  providerId: string,
  modelIds: string[],
  defaultProviderId: string | null,
  defaultModelId: string | null,
) => resolveProviderDefaultModelStatus({ providerId, modelIds, defaultProviderId, defaultModelId });

assert.deepEqual(status('provider-a', ['gpt-4o'], 'provider-a', 'gpt-4o'), {
  kind: 'default',
  modelId: 'gpt-4o',
});
assert.deepEqual(status('provider-b', ['claude-3-5-sonnet'], 'provider-a', 'gpt-4o'), { kind: 'none', modelId: null });
assert.deepEqual(
  status('provider-b', ['gpt-4o'], 'provider-a', 'gpt-4o'),
  { kind: 'none', modelId: null },
  'same model id on a non-default provider must not inherit the global default identity',
);
assert.deepEqual(status('provider-a', ['gpt-4o'], null, null), { kind: 'none', modelId: null });
assert.deepEqual(status('provider-b', ['claude-3-5-sonnet'], null, null), { kind: 'none', modelId: null });
assert.deepEqual(status('provider-a', ['gpt-4o'], 'provider-a', 'missing-model'), {
  kind: 'stale',
  modelId: 'missing-model',
});

const component = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/ModelProviderSettings.vue', import.meta.url),
  'utf8',
);
assert(component.includes("providerDefaultModelStatus(provider).kind !== 'none'"));
assert(component.includes("providerDefaultModelStatus(provider).kind === 'stale'"));
assert(component.includes('agent.settings.providers.defaultModelMissing'));
assert(!component.includes('defaultModelId || provider.models[0]?.id'));

process.stdout.write('Provider default model status regression: PASS\n');
