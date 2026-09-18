import type { JsonValue } from '../agent.types';
import type { ModelProviderContinuation } from './model.types';

export const MAX_MODEL_PROVIDER_CONTINUATION_BYTES = 256 * 1024;

const MAX_CONTINUATION_DEPTH = 32;
const MAX_CONTINUATION_NODES = 16_384;
const MAX_ID_BYTES = 512;
const MAX_FORMAT_BYTES = 256;

const boundedString = (value: unknown, maxBytes: number): string => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
  }
  return value;
};

const decodeJsonValue = (value: unknown): JsonValue => {
  let nodes = 0;
  const visit = (item: unknown, depth: number): JsonValue => {
    nodes += 1;
    if (nodes > MAX_CONTINUATION_NODES || depth > MAX_CONTINUATION_DEPTH) {
      throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
      return item;
    }
    if (Array.isArray(item)) return item.map((child) => visit(child, depth + 1));
    if (!item || typeof item !== 'object') throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      result[key] = visit(child, depth + 1);
    }
    return result;
  };
  return visit(value, 0);
};

export const decodeModelProviderContinuation = (value: unknown): ModelProviderContinuation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.configurationVersion) ||
    (record.configurationVersion as number) < 1
  ) {
    throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
  }
  if (record.protocol !== 'chat-completions' && record.protocol !== 'responses') {
    throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
  }
  const continuation: ModelProviderContinuation = {
    schemaVersion: 1,
    providerId: boundedString(record.providerId, MAX_ID_BYTES),
    modelId: boundedString(record.modelId, MAX_ID_BYTES),
    configurationVersion: record.configurationVersion as number,
    protocol: record.protocol,
    format: boundedString(record.format, MAX_FORMAT_BYTES),
    data: decodeJsonValue(record.data),
  };
  const encoded = JSON.stringify(continuation);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_MODEL_PROVIDER_CONTINUATION_BYTES) {
    throw new Error('MODEL_PROVIDER_CONTINUATION_TOO_LARGE');
  }
  return continuation;
};

export const encodeModelProviderContinuation = (value: ModelProviderContinuation): string =>
  JSON.stringify(decodeModelProviderContinuation(value));

export const continuationMatchesRoute = (
  continuation: ModelProviderContinuation,
  route: {
    providerId: string;
    modelId: string;
    configurationVersion: number;
    protocol: ModelProviderContinuation['protocol'];
  },
): boolean =>
  continuation.providerId === route.providerId &&
  continuation.modelId === route.modelId &&
  continuation.configurationVersion === route.configurationVersion &&
  continuation.protocol === route.protocol;
