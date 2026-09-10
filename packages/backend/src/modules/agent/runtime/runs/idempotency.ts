import { createHash } from 'node:crypto';
import type { JsonValue } from '../../agent.types';
import { isAgentUuid } from '../../uuid';

export const requireIdempotencyKey = (value: string): string => {
  if (!isAgentUuid(value)) throw new Error('IDEMPOTENCY_KEY_INVALID');
  return value.toLowerCase();
};

const canonical = (value: JsonValue): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`)
    .join(',')}}`;
};

export const requestHash = (schemaVersion: number, value: JsonValue): string =>
  createHash('sha256')
    .update(`${schemaVersion}\n${canonical(value)}`, 'utf8')
    .digest('hex');
