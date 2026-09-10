import type { JsonValue } from './agent.types';
import type { CryptoHashPort } from './crypto-hash.port';

const assertJsonValue = (value: JsonValue): void => {
  if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value)))
    throw new Error('VALIDATION_FAILED');
  if (typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('VALIDATION_FAILED');
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new Error('VALIDATION_FAILED');
      }
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) assertJsonValue(item);
  }
};

export const canonicalize = (value: JsonValue): string => {
  assertJsonValue(value);
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`)
    .join(',')}}`;
};

export const hashOperation = (value: JsonValue, cryptoHash: CryptoHashPort): string =>
  `v1:${cryptoHash.sha256Utf8(canonicalize(value))}`;
