import assert from 'node:assert/strict';
import fs from 'node:fs';

const component = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/ModelProviderSettings.vue', import.meta.url),
  'utf8',
);
const panel = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/AgentSettingsPanel.vue', import.meta.url),
  'utf8',
);

assert(component.includes('const optimisticDefaultModelKey = ref<string | null>(null);'));
assert(component.includes('() => [props.defaultProviderId, props.defaultModelId] as const'));
assert(component.includes('modelOptions.value.find((item) => item.key === optimisticDefaultModelKey.value)'));
assert(component.includes('() => props.settingsBusy'));
assert(component.includes('if (previous && !busy) optimisticDefaultModelKey.value = requestedDefaultModelKey();'));
assert(panel.includes(':settings-busy="settingsMutationBusy"'));
assert(!component.includes('optimisticDefaultModelId'));

process.stdout.write('Default model optimistic identity regression: PASS\n');
