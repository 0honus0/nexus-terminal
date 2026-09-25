import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/features/quick-commands/components/QuickCommandsPanel.vue', import.meta.url),
  'utf8',
);

assert.equal(
  (source.match(/quick-command-row group flex cursor-pointer[^"]*px-2\.5 py-1\.5/g) ?? []).length,
  0,
  'template utility padding must not override scale-owned Quick Commands row padding',
);

assert(
  source.includes('padding: max(0.1rem, calc(var(--quick-row-scale) * 0.5rem - 0.15rem))'),
  'normal Quick Commands rows must convert a 0.12 scale step into a visible vertical padding change',
);
assert(
  source.includes('padding-block: max(0.05rem, calc(var(--quick-row-scale) * 0.3rem - 0.15rem));'),
  'compact Quick Commands rows must keep bounded but responsive vertical scaling',
);

process.stdout.write('Quick Commands row scale regression: PASS\n');
