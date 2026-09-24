import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/ModelProviderSettings.vue', import.meta.url),
  'utf8',
);

assert(source.includes('let modalGeneration = 0;'));
assert(source.includes('let pullGeneration = 0;'));
assert(source.includes('const requestModalGeneration = modalGeneration;'));
assert(source.includes('const requestGeneration = ++pullGeneration;'));
assert(source.includes('const requestBaseUrl = form.baseUrl.trim();'));
assert(source.includes('const requestCredential = form.credential.trim();'));
assert(source.includes('const requestModelId = form.modelId.trim();'));
assert(source.includes('if (!isCurrentRequest()) return;'));
assert(source.includes('requestModalGeneration === modalGeneration'));
assert(source.includes('requestGeneration === pullGeneration'));
assert(source.includes('form.baseUrl.trim() === requestBaseUrl'));
assert(source.includes('form.credential.trim() === requestCredential'));
assert(source.includes('form.modelId.trim() === requestModelId'));

const closeModal = source.slice(source.indexOf('const closeModal = () => {'), source.indexOf('// 测试结果缓存'));
assert(closeModal.includes('modalGeneration += 1;'));
assert(closeModal.includes('pullGeneration += 1;'));
assert(closeModal.includes('isPullingModels.value = false;'));

process.stdout.write('provider pull generation regression: PASS\n');
