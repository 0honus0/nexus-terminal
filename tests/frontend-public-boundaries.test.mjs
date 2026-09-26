import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const guard = fileURLToPath(new URL('../scripts/checks/frontend/public-boundaries.mjs', import.meta.url));

const runGuard = (sourcePath, publicSource) => {
  const root = mkdtempSync(path.join(tmpdir(), 'frontend-boundaries-'));
  try {
    const owner = path.join(root, 'packages/frontend/src/features/example');
    const source = path.join(owner, sourcePath);
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, 'export type PublicType = string;\nexport interface InternalType { value: number }\n');
    writeFileSync(path.join(owner, 'public.ts'), publicSource);
    return spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('explicit public re-export leaves implementation types private', () => {
  const result = runGuard('model/example.ts', "export type { PublicType } from './model/example';\n");
  assert.equal(result.status, 0, result.stderr);
});

for (const source of ['contracts/example.ts', 'public-types.ts']) {
  test(`${source} requires complete type re-export`, () => {
    const specifier = `./${source.slice(0, -3)}`;
    const missing = runGuard(source, '');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /omits exported type PublicType/);

    const incomplete = runGuard(source, `export type { PublicType } from '${specifier}';\n`);
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stderr, /omits exported type InternalType/);

    const complete = runGuard(source, `export type { PublicType, InternalType } from '${specifier}';\n`);
    assert.equal(complete.status, 0, complete.stderr);

    const explicit = runGuard(source, `export { type PublicType, type InternalType } from '${specifier}';\n`);
    assert.equal(explicit.status, 0, explicit.stderr);
  });
}
