import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/SafetyNetworkSettings.vue', import.meta.url),
  'utf8',
);

assert(
  source.includes('const connectionsResolved = ref(connectionsStore.loaded.value);'),
  'resolved state must follow the authoritative store loaded flag, including a valid empty connection list',
);
assert(source.includes('const loadConnections = async (force = false): Promise<void> => {'));
assert(source.includes('await connectionsStore.load(force);'));
assert(source.includes('connectionsResolved.value = connectionsStore.loaded.value;'));
assert(source.includes('connectionLoadFailed.value = !connectionsStore.loaded.value;'));

const loadedWatch = source.indexOf('() => connectionsStore.loaded.value,');
const clearFailure = source.indexOf('if (loaded) connectionLoadFailed.value = false;', loadedWatch);
assert(loadedWatch >= 0 && clearFailure > loadedWatch, 'shared store recovery must clear the local failure state');
assert(source.includes('onMounted(() => void loadConnections());'), 'mount should use the same retryable load path');
assert(source.includes('@click="loadConnections(true)"'), 'the failure UI must expose an explicit forced retry');
assert(source.includes("{{ $t('common.retry') }}"));

process.stdout.write('safety network connection recovery regression: PASS\n');
