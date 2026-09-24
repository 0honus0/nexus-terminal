import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/ModelProviderSettings.vue', import.meta.url),
  'utf8',
);

assert(!source.includes('createdProviderId'));
const testStart = source.indexOf('const testInModal = async () => {');
const submitStart = source.indexOf('// 弹窗确认添加');
const testBlock = source.slice(testStart, submitStart);
assert(testBlock.includes('await agentApi.discoverEndpointModels({'));
assert(testBlock.includes('baseUrl: form.baseUrl.trim()'));
assert(testBlock.includes('credential: form.credential.trim() || undefined'));
assert(!testBlock.includes('props.createProvider('));
assert(!testBlock.includes('agentApi.testProvider('));
assert(testBlock.includes('const startedAt = performance.now();'));
assert(testBlock.includes('const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));'));

const submitBlock = source.slice(submitStart, source.indexOf('// 触发更新模型并打开抽屉'));
assert(submitBlock.includes('const saved = await props.createProvider(payload);'));
assert(!submitBlock.includes('modalOpen.value = false;\n      return;'));

process.stdout.write('provider transient connection test regression: PASS\n');
