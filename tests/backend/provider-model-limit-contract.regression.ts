import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AGENT_PROVIDER_MODEL_LIMIT } from '../../packages/protocol/src/agent-providers';

assert.equal(AGENT_PROVIDER_MODEL_LIMIT, 100);

const frontend = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/ModelProviderSettings.vue', import.meta.url),
  'utf8',
);
const backend = fs.readFileSync(
  new URL('../../packages/backend/src/modules/agent/ai/provider.service.ts', import.meta.url),
  'utf8',
);

assert(frontend.includes("import { AGENT_PROVIDER_MODEL_LIMIT } from '@nexus-terminal/protocol/agent-providers';"));
assert(frontend.includes('const MAX_PROVIDER_MODELS = AGENT_PROVIDER_MODEL_LIMIT;'));
assert(frontend.includes('pulledModels.value.slice(0, MAX_PROVIDER_MODELS)'));
assert(frontend.includes('notifyModelCapacity(Math.max(0, pulledModels.value.length - importedPulledModels.length));'));
assert(frontend.includes('const capacity = remainingModelCapacity(provider);'));
assert(frontend.includes('const newModels = resolved.slice(0, capacity);'));

assert(backend.includes("import { AGENT_PROVIDER_MODEL_LIMIT } from '@nexus-terminal/protocol/agent-providers';"));
assert(backend.includes('raw.models.length > AGENT_PROVIDER_MODEL_LIMIT'));

for (const count of [101, 1000]) {
  assert.equal(Math.min(count, AGENT_PROVIDER_MODEL_LIMIT), 100);
}
assert.equal(Math.min(11, AGENT_PROVIDER_MODEL_LIMIT - 90), 10);
assert.equal(Math.min(100, AGENT_PROVIDER_MODEL_LIMIT), 100);

process.stdout.write('Provider model limit contract regression: PASS\n');
