import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../packages/frontend/src/features/agent/host/AgentSurfaceHost.vue', import.meta.url),
  'utf8',
);

assert(source.includes('while (!controller.signal.aborted && currentGeneration === generation)'));
assert(source.includes("const initial = await refresh('initial');"));
assert(source.includes('await waitForHostRefreshRetry(refreshAttempt, controller.signal);'));
assert(source.includes("'Agent global surface initial summary unavailable; retrying'"));

const initialRefreshCalls = source.match(/refresh\('initial'\)/g) ?? [];
assert.equal(initialRefreshCalls.length, 1, 'initial summary refresh must be owned only by the leader retry loop');

const authAttach = source.slice(
  source.indexOf('agentWindowManager.restoreForUser(userId);'),
  source.indexOf('return;', source.indexOf('agentWindowManager.restoreForUser(userId);')),
);
assert(!authAttach.includes("refresh('initial')"), 'auth attach must not race a second initial summary request');
assert(authAttach.includes('start();'));

process.stdout.write('agent host initial refresh recovery regression: PASS\n');
