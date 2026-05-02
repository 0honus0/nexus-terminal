import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager, CACHE_KEYS, CACHE_CONFIG } from '../cacheManager';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
    _reset: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    localStorageMock._reset();
    vi.clearAllMocks();
    cache = new CacheManager('test_');
  });

  describe('get / set', () => {
    it('应该存储和读取数据', () => {
      cache.set('key1', { name: 'test' });
      const result = cache.get('key1', { name: 'default' });
      expect(result).toEqual({ name: 'test' });
    });

    it('缓存不存在时应该返回默认值', () => {
      const result = cache.get('nonexistent', 'default');
      expect(result).toBe('default');
    });

    it('应该支持不同数据类型', () => {
      cache.set('string', 'hello');
      cache.set('number', 42);
      cache.set('array', [1, 2, 3]);
      cache.set('object', { key: 'value' });

      expect(cache.get('string', '')).toBe('hello');
      expect(cache.get('number', 0)).toBe(42);
      expect(cache.get('array', [])).toEqual([1, 2, 3]);
      expect(cache.get('object', {})).toEqual({ key: 'value' });
    });
  });

  describe('版本控制', () => {
    it('版本不匹配时应该返回默认值', () => {
      cache.set('key1', 'value1', { version: 1 });
      const result = cache.get('key1', 'default', { version: 2 });
      expect(result).toBe('default');
    });

    it('版本匹配时应该返回缓存值', () => {
      cache.set('key1', 'value1', { version: 1 });
      const result = cache.get('key1', 'default', { version: 1 });
      expect(result).toBe('value1');
    });
  });

  describe('TTL 过期', () => {
    it('未过期时应该返回缓存值', () => {
      cache.set('key1', 'value1');
      const result = cache.get('key1', 'default', { ttl: 60000 });
      expect(result).toBe('value1');
    });

    it('过期时应该返回默认值', () => {
      // 直接写入过期数据
      const fullKey = 'test_key1';
      const expiredData = {
        version: 1,
        timestamp: Date.now() - 120000, // 2分钟前
        data: 'value1',
      };
      localStorageMock.setItem(fullKey, JSON.stringify(expiredData));

      const result = cache.get('key1', 'default', { ttl: 60000 });
      expect(result).toBe('default');
    });
  });

  describe('has', () => {
    it('应该检查缓存是否存在', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('过期时应该返回 false', () => {
      const fullKey = 'test_key1';
      const expiredData = {
        version: 1,
        timestamp: Date.now() - 120000,
        data: 'value1',
      };
      localStorageMock.setItem(fullKey, JSON.stringify(expiredData));
      expect(cache.has('key1', { ttl: 60000 })).toBe(false);
    });
  });

  describe('remove', () => {
    it('应该删除缓存', () => {
      cache.set('key1', 'value1');
      cache.remove('key1');
      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('clear', () => {
    it('应该清除所有带前缀的缓存', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });
  });

  describe('clearExpired', () => {
    it('应该清除过期缓存', () => {
      // 写入过期数据
      const expiredKey = 'test_expired';
      const expiredData = {
        version: 1,
        timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31天前
        data: 'expired',
      };
      localStorageMock.setItem(expiredKey, JSON.stringify(expiredData));

      // 写入有效数据
      cache.set('valid', 'value');

      cache.clearExpired();

      // 过期的应该被清除，有效的应该保留
      expect(cache.has('valid')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('应该返回缓存统计', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const stats = cache.getStats();
      expect(stats.count).toBe(2);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe('错误处理', () => {
    it('读取损坏的缓存应该返回默认值', () => {
      const fullKey = 'test_corrupted';
      localStorageMock.setItem(fullKey, 'not-valid-json');
      const result = cache.get('corrupted', 'default');
      expect(result).toBe('default');
    });
  });
});

describe('CACHE_KEYS 和 CACHE_CONFIG', () => {
  it('应该定义所有缓存键', () => {
    expect(CACHE_KEYS.CONNECTIONS).toBe('connections');
    expect(CACHE_KEYS.TAGS).toBe('tags');
    expect(CACHE_KEYS.SETTINGS).toBe('settings');
  });

  it('应该为每个键定义配置', () => {
    for (const key of Object.values(CACHE_KEYS)) {
      expect(CACHE_CONFIG[key]).toBeDefined();
      expect(CACHE_CONFIG[key].version).toBeGreaterThan(0);
    }
  });
});
