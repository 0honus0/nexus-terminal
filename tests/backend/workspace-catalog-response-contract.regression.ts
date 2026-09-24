import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeCatalog } from '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http-protocol';

const packs = Array.from({ length: 4096 }, (_, index) => ({
  familyId: `family-${index}`,
  versionId: '1.0.0',
  displayName: `${'x'.repeat(320)}-${index}`,
  contentDigest: `sha256:${'a'.repeat(64)}`,
  diskBytes: 1,
  status: 'supported',
  installed: false,
  enabled: true,
  inUse: false,
}));
const wire = {
  revision: 'catalog-1',
  runtimeDigest: `sha256:${'b'.repeat(64)}`,
  recipes: [],
  packs,
};
const bytes = Buffer.byteLength(JSON.stringify(wire), 'utf8');
assert(bytes > 1024 * 1024, 'fixture must exceed the old generic 1MB transport cap');
assert(bytes < 8 * 1024 * 1024, 'fixture must fit the catalog route envelope');
assert.equal(decodeCatalog(wire).packs.length, 4096);

const source = fs.readFileSync(
  new URL('../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter.ts', import.meta.url),
  'utf8',
);
assert(source.includes('const MAX_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;'));
assert(
  source.includes("this.get('/v1/catalog', signal, { maxResponseBytes: MAX_CATALOG_RESPONSE_BYTES })"),
  'catalog route must not use the generic 1MB response envelope',
);

process.stdout.write(`Workspace catalog response contract regression: PASS (${bytes} bytes)\n`);
