import { totalPrice } from './src/catalog.mjs';

if (typeof totalPrice !== 'function') throw new Error('CATALOG_EXPORT_INVALID');
console.log('Catalog build passed.');
