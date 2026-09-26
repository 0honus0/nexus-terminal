import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  browserStorageKey,
  jsonStorageCodec,
  numberStorageCodec,
  readStoredValue,
  writeStoredValue,
} from '../../../packages/frontend/src/foundation/browser/storage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const originalWindow = globalThis.window;

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage, sessionStorage },
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('browser storage contracts', () => {
  it('builds deterministic versioned and scoped keys', () => {
    expect(browserStorageKey('workspace.layout', 2)).toBe('nexus.workspace.layout.v2');
    expect(browserStorageKey('agent.thread-scale', 1, { kind: 'user', id: 42 })).toBe(
      'nexus.agent.thread-scale.user.42.v1',
    );
    expect(browserStorageKey('runtime.marker', 3, { kind: 'session', id: 'a/b' })).toBe(
      'nexus.runtime.marker.session.a%2Fb.v3',
    );
  });

  it('rejects malformed values through the declared decoder', () => {
    const definition = {
      namespace: 'test.number',
      version: 1,
      codec: numberStorageCodec((value) => value >= 1 && value <= 10),
    } as const;
    localStorage.setItem(browserStorageKey(definition.namespace, definition.version), '99');
    expect(readStoredValue(definition)).toBeUndefined();
    expect(localStorage.getItem(browserStorageKey(definition.namespace, definition.version))).toBeNull();
  });

  it('migrates a valid legacy value once', () => {
    const definition = {
      namespace: 'test.geometry',
      version: 2,
      codec: jsonStorageCodec<{ x: number; y: number }>((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const candidate = value as Record<string, unknown>;
        return typeof candidate.x === 'number' && typeof candidate.y === 'number'
          ? { x: candidate.x, y: candidate.y }
          : undefined;
      }),
      legacyKeys: ['legacy.geometry'],
    } as const;

    localStorage.setItem('legacy.geometry', JSON.stringify({ x: 12, y: 18 }));
    expect(readStoredValue(definition)).toEqual({ x: 12, y: 18 });
    expect(localStorage.getItem('legacy.geometry')).toBeNull();
    expect(localStorage.getItem(browserStorageKey(definition.namespace, definition.version))).toBe(
      JSON.stringify({ x: 12, y: 18 }),
    );
  });

  it('uses session storage when requested', () => {
    const definition = {
      namespace: 'test.session',
      version: 1,
      area: 'session',
      codec: numberStorageCodec(),
    } as const;
    expect(writeStoredValue(definition, 7)).toBe(true);
    expect(sessionStorage.getItem(browserStorageKey(definition.namespace, definition.version))).toBe('7');
    expect(localStorage.length).toBe(0);
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});
