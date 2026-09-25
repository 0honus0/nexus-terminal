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
assert(source.includes("'--quick-row-min-height': `${scale * 1.875}rem`"));
assert(source.includes("'--quick-row-padding-block': `${Math.max(0.1, scale * 0.5 - 0.15)}rem`"));
assert(source.includes("'--quick-row-compact-min-height': `${scale * 1.5}rem`"));
assert(source.includes('min-height: var(--quick-row-min-height);'));
assert(source.includes('padding-block: var(--quick-row-padding-block);'));
assert(source.includes('min-height: var(--quick-row-compact-min-height);'));
const rowRule = source.match(/\.quick-command-row\s*\{([^}]*)\}/s)?.[1] ?? '';
assert(
  !rowRule.includes('calc(var(--quick-row-scale)'),
  'row geometry must not depend on browser support for CSS number-by-length multiplication',
);

process.stdout.write('Quick Commands row scale regression: PASS\n');
