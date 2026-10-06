import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { totalPrice } from './src/catalog.mjs';

const items = JSON.parse(readFileSync(new URL('./data/catalog.json', import.meta.url), 'utf8'));
assert.equal(totalPrice(items), 29.5);
assert.equal(totalPrice([]), 0);
assert.equal(totalPrice([{ price: 2.25, quantity: 4 }]), 9);
console.log('Catalog verification passed.');
