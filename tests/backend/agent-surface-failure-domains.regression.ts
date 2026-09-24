import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  clearAgentSurfaceFailure,
  clearAgentSurfaceFailures,
  latestAgentSurfaceFailure,
  upsertAgentSurfaceFailure,
  type AgentSurfaceFailure,
} from '../../packages/frontend/src/features/agent/host/agent-surface-failures';

type Retry = { labelKey: string; id: string };
type Failure = AgentSurfaceFailure<Retry>;

const failure = (domainKey: string, message: string, retryId: string): Failure => ({
  domainKey,
  message,
  code: `CODE_${retryId}`,
  retry: { labelKey: 'agent.operations.retry', id: retryId },
});

let slots: Failure[] = [];
slots = upsertAgentSurfaceFailure(slots, failure('configuration', 'config failed', 'config-1'));
slots = upsertAgentSurfaceFailure(slots, failure('transcript', 'transcript failed', 'transcript-1'));
assert.equal(latestAgentSurfaceFailure(slots)?.domainKey, 'transcript');

slots = clearAgentSurfaceFailure(slots, 'threads');
assert.deepEqual(
  slots.map((item) => item.domainKey),
  ['configuration', 'transcript'],
  'clearing an unrelated domain must not destroy existing failures',
);

slots = clearAgentSurfaceFailure(slots, 'transcript');
assert.equal(
  latestAgentSurfaceFailure(slots)?.domainKey,
  'configuration',
  'clearing the visible domain must reveal the prior independent failure',
);
assert.equal(latestAgentSurfaceFailure(slots)?.retry?.id, 'config-1');

slots = upsertAgentSurfaceFailure(slots, failure('configuration', 'config failed again', 'config-2'));
assert.equal(slots.length, 1, 'a domain owns exactly one failure slot');
assert.equal(latestAgentSurfaceFailure(slots)?.retry?.id, 'config-2', 'same-domain failure must replace its retry');

slots = upsertAgentSurfaceFailure(slots, failure('stream', 'stream failed', 'stream-1'));
slots = upsertAgentSurfaceFailure(slots, failure('mutation', 'mutation failed', 'mutation-1'));
slots = clearAgentSurfaceFailures(slots, ['stream', 'mutation']);
assert.deepEqual(
  slots.map((item) => item.domainKey),
  ['configuration'],
  'context cleanup must remove only the domains it explicitly owns',
);

const root = path.resolve(process.cwd(), '../..');
const surface = readFileSync(path.join(root, 'packages/frontend/src/features/agent/host/AgentAppSurface.vue'), 'utf8');
assert(!surface.includes('const error = ref('));
assert(!surface.includes('const errorDomainKey = ref('));
assert(!surface.includes('const errorCode = ref('));
assert(!surface.includes('const errorRetry = shallowRef('));
assert(!/clearError\(\)/.test(surface), 'all internal clears must name a domain');
assert(surface.includes('const errorSlots = shallowRef<AgentSurfaceFailure<AgentSurfaceRetry>[]>([]);'));
assert(surface.includes('clearErrors(THREAD_CONTEXT_FAILURE_DOMAINS);'));
assert(surface.includes("clearError('agent.operations.failureDomain.configuration');"));
assert(surface.includes("clearError('agent.operations.failureDomain.threads');"));
assert(surface.includes("clearError('agent.operations.failureDomain.mutation');"));
assert(surface.includes('@dismiss-error="clearCurrentError"'));

process.stdout.write('agent surface failure domains regression: PASS\n');
