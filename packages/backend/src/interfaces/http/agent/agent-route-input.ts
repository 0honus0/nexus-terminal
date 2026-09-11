import type { JsonValue } from '../../../modules/agent/agent.types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isJsonValue = (value: unknown, depth = 0): value is JsonValue => {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
};

export const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

export class AgentRequestError extends Error {
  readonly details: unknown;

  constructor(code: string, details: unknown) {
    super(code);
    this.name = 'AgentRequestError';
    this.details = details;
  }
}

export const versionedRecord = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!isRecord(value) || !hasOnlyKeys(value, [...keys, 'schemaVersion'])) throw new Error('VALIDATION_FAILED');
  const schemaVersion = value.schemaVersion ?? 1;
  if (schemaVersion !== 1) {
    throw new AgentRequestError('SCHEMA_VERSION_UNSUPPORTED', {
      field: 'schemaVersion',
      expectedVersion: 1,
      actualVersion: Number.isSafeInteger(schemaVersion) ? schemaVersion : null,
      actualType: schemaVersion === null ? 'null' : Array.isArray(schemaVersion) ? 'array' : typeof schemaVersion,
    });
  }
  return value;
};

export const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

export const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export const queryString = (value: unknown): string | undefined => {
  const scalar = Array.isArray(value) ? value[0] : value;
  return typeof scalar === 'string' && scalar.length > 0 ? scalar : undefined;
};

export const pathParam = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error('VALIDATION_FAILED');
  return value;
};

export const withVersionConflictDetails = async <T>(
  expectedVersion: number,
  readCurrentVersion: () => Promise<number>,
  action: () => Promise<T>,
  conflictCodes: readonly string[] = ['STATE_CONFLICT'],
): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (!conflictCodes.includes(code)) throw error;
    try {
      const currentVersion = await readCurrentVersion();
      if (currentVersion !== expectedVersion) {
        throw new AgentRequestError(code, {
          field: 'expectedVersion',
          expectedVersion,
          currentVersion,
        });
      }
    } catch (readError) {
      if (readError instanceof AgentRequestError) throw readError;
    }
    throw error;
  }
};
