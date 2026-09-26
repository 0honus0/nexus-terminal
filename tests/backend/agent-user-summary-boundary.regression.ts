import assert from 'node:assert/strict';
import { toolResultLedgerPayloadFromEvidence } from '../../packages/backend/src/infrastructure/agent/runtime/state-commit/tool-transition-result';

const evidence = JSON.stringify({
  ok: false,
  outcome: 'confirmed',
  errorCode: 'TEST_FAILURE',
  summary: 'Model-visible execution evidence.',
});
const userSummary = {
  key: 'agent.conversation.toolSummary.test',
  params: { count: 1 },
};
const payload = toolResultLedgerPayloadFromEvidence('provider-call-1', evidence, userSummary);

assert.deepEqual(payload.userSummary, userSummary);
assert.equal(payload.text, evidence);
assert.equal(Object.hasOwn(JSON.parse(String(payload.text)) as Record<string, unknown>, 'userSummary'), false);

console.log('agent user-summary boundary regression: PASS');
