import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const slice = (source: string, startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `expected source slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

const bridge = read('packages/frontend/src/features/agent/plugin-sdk/host-bridge.ts');
assert(
  bridge.includes('PLUGIN_FRONTEND_MUTATION_RPC_METHODS'),
  'host bridge must classify mutation RPC methods separately from reads',
);
assert(
  bridge.includes('(!mutationMethods.has(message.method) || operationIdPattern.test(message.id))'),
  'mutation wire ids must be valid stable operation UUIDs',
);
const forward = slice(bridge, 'private async forward', 'private async dispatchBinary');
assert(
  forward.includes("isMutation ? 'HOST_RPC_OUTCOME_UNKNOWN' : 'HOST_RPC_TIMEOUT'"),
  'mutation deadline must report outcome unknown instead of ordinary timeout failure',
);
assert(
  forward.includes('isMutation ? request.id : undefined'),
  'mutation outcome-unknown response must carry the stable operation id',
);
assert(
  forward.includes('const outcome = await Promise.race([execution, timeout]);'),
  'deadline must respond without waiting for a still-running mutation to finish',
);
assert(
  forward.includes('resolve({ kind: \'timeout\' });\n          controller.abort();'),
  'timeout outcome must win the race before aborting any client-side HTTP wait',
);

const sdk = read('packages/backend/src/infrastructure/agent/plugins/frontend-sdk/frontend-v1.mjs');
assert(
  sdk.includes("error.outcomeUnknown = code === 'HOST_RPC_OUTCOME_UNKNOWN' || code === 'NEXUS_PLUGIN_MUTATION_OUTCOME_UNKNOWN';"),
  'plugin SDK errors must identify unknown mutation outcomes',
);
assert(
  sdk.includes('error.operationId = operationId;'),
  'plugin SDK must return the reusable operation id to the caller',
);
assert(
  sdk.includes("mutation\n            ? requestError('NEXUS_PLUGIN_MUTATION_OUTCOME_UNKNOWN', id)"),
  'the SDK-side fallback deadline must also preserve unknown-outcome semantics',
);
for (const snippet of [
  "request('intents.create', { receiverAppId, intentId, input, artifactRefs, confirmed }, operationId)",
  "request('agent.threads.create', title === undefined ? {} : { title }, operationId)",
  "request('agent.runs.create', input, operationId)",
  "request('agent.runs.appendInput', { runId, text, artifactRefs }, operationId)",
  "request('agent.runs.cancel', { runId }, operationId)",
  "request('agent.approvals.resolve', { approvalId, runId, decision }, operationId)",
]) {
  assert(sdk.includes(snippet), `SDK mutation API must forward operation id: ${snippet}`);
}

const dispatcher = read('packages/frontend/src/features/agent/plugin-sdk/agent-dispatcher.ts');
assert(
  dispatcher.includes('rawParams: unknown, operationId?: string'),
  'Agent dispatcher must receive the stable operation id',
);
assert(
  dispatcher.includes('this.runFacade.createThread(optionalString(params.title, 4_096), operationId)'),
  'thread create must receive the plugin operation id',
);
assert(
  dispatcher.includes('}, operationId);'),
  'run create must receive the plugin operation id',
);
assert(
  dispatcher.includes('this.runFacade.cancelRun(await this.runFacade.getRun(string(params.runId)), operationId)'),
  'run cancel must receive the plugin operation id',
);
assert(
  dispatcher.includes('this.runFacade.resolveApproval(approval, decision, undefined, operationId)'),
  'approval resolve must receive the plugin operation id',
);

const agentApi = read('packages/frontend/src/features/agent/api/agent-api.ts');
assert(
  agentApi.includes("...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})"),
  'thread create must forward optional plugin idempotency identity',
);
for (const marker of [
  "headers: { ...(await mutationHeaders()), 'Idempotency-Key': idempotencyKey }",
]) {
  assert(
    agentApi.split(marker).length - 1 >= 4,
    'Run/approval mutation APIs must use caller-provided idempotency keys instead of regenerating them',
  );
}

const threadService = read('packages/backend/src/modules/agent/ai/conversation.service.ts');
assert(
  threadService.includes('const threadId = idempotencyKey ? requireIdempotencyKey(idempotencyKey) : randomUUID();'),
  'plugin thread create must use the operation id as durable thread identity',
);
assert(
  threadService.includes("throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');"),
  'thread replay must reject operation-id reuse with a different payload',
);
const threadRepository = read('packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository.ts');
assert(
  threadRepository.includes('INSERT OR IGNORE INTO ai_threads'),
  'concurrent thread create replays must collapse on the same durable id',
);
assert(
  threadRepository.includes('inserted.changes === 0'),
  'thread repository must distinguish create from replay',
);

const appIntent = read('packages/backend/src/modules/agent/host/app-intent.service.ts');
assert(
  appIntent.includes('const receiptId = idempotencyKey ? requireIdempotencyKey(idempotencyKey) : randomUUID();'),
  'frontend AppIntent create must use the operation id as receipt identity',
);
assert(
  appIntent.includes('const existing = await this.repository.get(scope.userId, receiptId);'),
  'AppIntent retry must reconcile against an existing receipt before creating a second one',
);
assert(
  appIntent.includes('existingHash !== requestedHash'),
  'AppIntent operation-id reuse must verify the semantic payload',
);
const appIntentRepository = read('packages/backend/src/infrastructure/agent/repositories/sqlite-app-intent.repository.ts');
assert(
  appIntentRepository.includes('INSERT OR IGNORE INTO agent_app_intent_receipts'),
  'concurrent AppIntent replays must collapse on the same receipt id',
);
assert(
  appIntentRepository.includes('if (inserted.changes === 0)'),
  'AppIntent repository must return the existing receipt on durable replay',
);

const pluginData = read('packages/backend/src/modules/agent/host/plugin-data-manager.ts');
assert(
  pluginData.includes('FRONTEND_MUTATION_METHODS.has(request.method) && !operationId'),
  'backend frontend RPC must reject mutation requests that lack a stable operation id',
);
assert(
  pluginData.includes('operationId,\n        )) as unknown as JsonValue;'),
  'frontend AppIntent create must pass the validated operation id into the durable service',
);

process.stdout.write('plugin RPC outcome unknown regression: PASS\n');
