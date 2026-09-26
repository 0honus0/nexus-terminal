export type BrowserStorageArea = 'local' | 'session';

export type BrowserStorageScope =
  { kind: 'global' } | { kind: 'user'; id: string | number } | { kind: 'session'; id: string | number };

export interface BrowserStorageCodec<T> {
  decode(raw: string): T | undefined;
  encode(value: T): string;
}

export interface BrowserStorageDefinition<T> {
  namespace: string;
  version: number;
  codec: BrowserStorageCodec<T>;
  area?: BrowserStorageArea;
  scope?: BrowserStorageScope;
  legacyKeys?: readonly string[];
}

const GLOBAL_SCOPE: BrowserStorageScope = { kind: 'global' };

const scopeSegment = (scope: BrowserStorageScope): string =>
  scope.kind === 'global' ? '' : `.${scope.kind}.${encodeURIComponent(String(scope.id))}`;

export const browserStorageKey = (
  namespace: string,
  version: number,
  scope: BrowserStorageScope = GLOBAL_SCOPE,
): string => {
  if (!namespace || !Number.isInteger(version) || version < 1) throw new Error('INVALID_BROWSER_STORAGE_KEY');
  return `nexus.${namespace}${scopeSegment(scope)}.v${version}`;
};

const resolveStorage = (area: BrowserStorageArea): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return area === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const currentKey = <T>(definition: BrowserStorageDefinition<T>): string =>
  browserStorageKey(definition.namespace, definition.version, definition.scope);

const readRaw = (storage: Storage, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const removeRaw = (storage: Storage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    // Persistence is best-effort; in-memory state remains authoritative for this page.
  }
};

const writeRaw = (storage: Storage, key: string, value: string): boolean => {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const readStoredValue = <T>(definition: BrowserStorageDefinition<T>): T | undefined => {
  const storage = resolveStorage(definition.area ?? 'local');
  if (!storage) return undefined;

  const key = currentKey(definition);
  const raw = readRaw(storage, key);
  if (raw !== null) {
    const decoded = definition.codec.decode(raw);
    if (decoded !== undefined) return decoded;
    removeRaw(storage, key);
  }

  for (const legacyKey of definition.legacyKeys ?? []) {
    const legacyRaw = readRaw(storage, legacyKey);
    if (legacyRaw === null) continue;
    const decoded = definition.codec.decode(legacyRaw);
    removeRaw(storage, legacyKey);
    if (decoded === undefined) continue;
    writeRaw(storage, key, definition.codec.encode(decoded));
    return decoded;
  }

  return undefined;
};

export const writeStoredValue = <T>(definition: BrowserStorageDefinition<T>, value: T): boolean => {
  const storage = resolveStorage(definition.area ?? 'local');
  if (!storage) return false;
  return writeRaw(storage, currentKey(definition), definition.codec.encode(value));
};

export const removeStoredValue = <T>(definition: BrowserStorageDefinition<T>): void => {
  const storage = resolveStorage(definition.area ?? 'local');
  if (!storage) return;
  removeRaw(storage, currentKey(definition));
};

export const removeLegacyStorageKeys = (keys: readonly string[], area: BrowserStorageArea = 'local'): void => {
  const storage = resolveStorage(area);
  if (!storage) return;
  for (const key of keys) removeRaw(storage, key);
};

export const stringStorageCodec = (validate: (value: string) => boolean = () => true): BrowserStorageCodec<string> => ({
  decode: (raw) => (validate(raw) ? raw : undefined),
  encode: (value) => value,
});

export const booleanStorageCodec: BrowserStorageCodec<boolean> = {
  decode: (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined),
  encode: (value) => String(value),
};

export const numberStorageCodec = (
  validate: (value: number) => boolean = Number.isFinite,
): BrowserStorageCodec<number> => ({
  decode: (raw) => {
    if (raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && validate(value) ? value : undefined;
  },
  encode: (value) => String(value),
});

export const jsonStorageCodec = <T>(decode: (value: unknown) => T | undefined): BrowserStorageCodec<T> => ({
  decode: (raw) => {
    try {
      return decode(JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  },
  encode: (value) => JSON.stringify(value),
});
