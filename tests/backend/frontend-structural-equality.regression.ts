import assert from 'node:assert/strict';
import { structurallyEqual } from '../../packages/frontend/src/foundation/data/structurallyEqual';

assert.equal(
  structurallyEqual(
    { alpha: 1, nested: { left: true, right: ['a', 'b'] } },
    { nested: { right: ['a', 'b'], left: true }, alpha: 1 },
  ),
  true,
  'plain-object insertion order must not affect structural equality',
);
assert.equal(structurallyEqual({ alpha: 1 }, { alpha: 2 }), false);
assert.equal(structurallyEqual(['a', 'b'], ['b', 'a']), false, 'array order remains semantic');
assert.equal(
  structurallyEqual({ value: undefined }, {}),
  false,
  'missing and explicitly undefined keys remain distinct',
);
assert.equal(
  structurallyEqual(new Map([['a', 1]]), new Map([['a', 1]])),
  false,
  'non-plain objects do not gain implicit semantics',
);

console.log('frontend structural equality regression: PASS');
