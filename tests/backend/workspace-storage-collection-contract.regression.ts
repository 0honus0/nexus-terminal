import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeStorage } from '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http-protocol';

const storage = (count: number) => ({
  stateBytes: 0,
  packBytes: 0,
  stagingPackBytes: 0,
  cacheBytes: 0,
  runtimeBytes: 0,
  quarantineBytes: 0,
  reclaimableBytes: 0,
  byPack: [],
  byWorkspace: Array.from({ length: count }, (_, index) => ({
    workspaceId: `workspace-${index}`,
    runtimeBytes: index,
    status: 'stopped',
  })),
  filesystem: { totalBytes: 1, freeBytes: 1 },
});

for (const count of [4096, 4097, 10_000, 16_384]) {
  const decoded = decodeStorage(storage(count));
  assert.equal(decoded.byWorkspace.length, count, `storage decoder must accept ${count} legal Workspace rows`);
}

assert.throws(() => decodeStorage(storage(16_385)), /WORKSPACE_RUNTIME_PROTOCOL_INVALID/);

const adapterSource = fs.readFileSync(
  new URL('../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter.ts', import.meta.url),
  'utf8',
);
assert(adapterSource.includes('const MAX_STORAGE_RESPONSE_BYTES = 8 * 1024 * 1024;'));
assert(
  adapterSource.includes("this.get('/v1/storage', signal, { maxResponseBytes: MAX_STORAGE_RESPONSE_BYTES })"),
  'storage route must use its collection-derived response envelope',
);

process.stdout.write('Workspace storage collection contract regression: PASS\n');
