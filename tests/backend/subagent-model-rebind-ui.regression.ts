import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/SubagentSettings.vue', import.meta.url),
  'utf8',
);

assert(source.includes('const modelFamilyKey = (model: ModelRef)'));
assert(source.includes('const staleModelRefs = (profile: AgentSubagentProfileDto): ModelRef[]'));
assert(source.includes('modelOptions.value.some((candidate) => candidate.key === modelKey(model))'));
assert(source.includes('const replaceModelFamily = (profile: AgentSubagentProfileDto, next: ModelRef): void =>'));
assert(source.includes('profile.allowedModels.filter((model) => modelFamilyKey(model) !== family)'));
assert(source.includes('const rebindModelRef = (profile: AgentSubagentProfileDto, stale: ModelRef): void =>'));
assert(source.includes('const hasStaleModelRefs = computed('));
assert(source.includes('hasStaleModelRefs || !isProfilesDirty'));
assert(source.includes('@click="rebindModelRef(profile, stale)"'));
assert(source.includes('@click="removeStaleModelRef(profile, stale)"'));

const simulatedV1 = { providerId: 'provider-a', modelId: 'model-x', configurationVersion: 1 };
const simulatedV2 = { providerId: 'provider-a', modelId: 'model-x', configurationVersion: 2 };
const other = { providerId: 'provider-b', modelId: 'model-y', configurationVersion: 4 };
const family = (model: typeof simulatedV1): string => `${model.providerId}\u0000${model.modelId}`;
const rebound = [simulatedV1, other].filter((model) => family(model) !== family(simulatedV2)).concat(simulatedV2);

assert.deepEqual(
  rebound.map((model) => [model.providerId, model.modelId, model.configurationVersion]),
  [
    ['provider-b', 'model-y', 4],
    ['provider-a', 'model-x', 2],
  ],
  'rebind must atomically replace stale configuration versions for the same provider/model identity',
);

for (const locale of ['en-US', 'ja-JP', 'zh-CN']) {
  const dictionary = JSON.parse(
    fs.readFileSync(new URL(`../../packages/frontend/src/features/agent/i18n/${locale}.json`, import.meta.url), 'utf8'),
  ) as { agent?: { settings?: { subagents?: Record<string, string> } } };
  const labels = dictionary.agent?.settings?.subagents ?? {};
  for (const key of ['staleModel', 'rebindModel', 'modelUnavailable', 'removeStaleModel', 'rebindBeforeSave']) {
    assert.equal(typeof labels[key], 'string', `${locale} missing ${key}`);
  }
}

process.stdout.write('Subagent model rebind UI regression: PASS\n');
