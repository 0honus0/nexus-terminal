import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL(
    '../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter.ts',
    import.meta.url,
  ),
  'utf8',
);

assert(
  source.includes("void this.handleLine(line.toString('utf8')).catch((error) => this.protocolFailure(error));"),
  'every decoded stdout line must have an explicit Promise rejection owner',
);
assert(source.includes('private protocolFailure(error: unknown): void {'));
assert(source.includes("if (!this.child.killed) this.child.kill('SIGKILL');"));

for (const decoder of [
  'decodeLifecycleResult(message)',
  'decodeStorageRequest(message)',
  'decodeIntentRequest(message)',
]) {
  assert(source.includes(decoder), `fixture expects ${decoder}`);
}

assert(
  !source.includes("for (const line of this.stdoutLines.push(chunk)) void this.handleLine(line.toString('utf8'));"),
  'fire-and-forget line handling must not regress',
);

process.stdout.write('Plugin Backend line error owner regression: PASS\n');
