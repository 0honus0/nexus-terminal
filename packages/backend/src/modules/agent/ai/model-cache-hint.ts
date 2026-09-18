import { createHash } from 'node:crypto';

export const modelCacheLineageKey = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('base64url');
