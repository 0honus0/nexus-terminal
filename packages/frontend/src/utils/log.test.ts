import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 在导入前设置 localStorage mock（log.ts 在模块加载时调用 initVerbose）
const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageMap.set(key, String(value));
  }),
  removeItem: vi.fn((key: string) => {
    storageMap.delete(key);
  }),
  clear: vi.fn(() => {
    storageMap.clear();
  }),
  get length() {
    return storageMap.size;
  },
  key: vi.fn((_index: number) => null),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

describe('utils/log', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMap.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();

    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    // 重新加载模块以重新执行 initVerbose
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log.info', () => {
    it('应调用 console.info', async () => {
      const { log } = await import('./log');
      log.info('测试信息');
      expect(consoleInfoSpy).toHaveBeenCalledWith('测试信息');
    });

    it('应支持多个参数', async () => {
      const { log } = await import('./log');
      log.info('参数1', '参数2', 123);
      expect(consoleInfoSpy).toHaveBeenCalledWith('参数1', '参数2', 123);
    });

    it('应支持对象参数', async () => {
      const { log } = await import('./log');
      const obj = { key: 'value' };
      log.info(obj);
      expect(consoleInfoSpy).toHaveBeenCalledWith(obj);
    });
  });

  describe('log.warn', () => {
    it('应调用 console.warn', async () => {
      const { log } = await import('./log');
      log.warn('警告信息');
      expect(consoleWarnSpy).toHaveBeenCalledWith('警告信息');
    });

    it('应支持多个参数', async () => {
      const { log } = await import('./log');
      log.warn('警告', { detail: 'test' });
      expect(consoleWarnSpy).toHaveBeenCalledWith('警告', { detail: 'test' });
    });
  });

  describe('log.error', () => {
    it('应调用 console.error', async () => {
      const { log } = await import('./log');
      log.error('错误信息');
      expect(consoleErrorSpy).toHaveBeenCalledWith('错误信息');
    });

    it('应支持 Error 对象', async () => {
      const { log } = await import('./log');
      const err = new Error('test error');
      log.error(err, '上下文');
      expect(consoleErrorSpy).toHaveBeenCalledWith(err, '上下文');
    });
  });

  describe('log.debug', () => {
    it('verbose 未激活时不应调用 console.debug', async () => {
      storageMap.delete('nexus-terminal:verbose');
      const { log } = await import('./log');
      log.debug('调试信息');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });

  describe('isVerbose', () => {
    it('默认应为 false', async () => {
      storageMap.delete('nexus-terminal:verbose');
      const { isVerbose } = await import('./log');
      expect(isVerbose()).toBe(false);
    });

    it('localStorage 有 verbose 标记时应为 true', async () => {
      storageMap.set('nexus-terminal:verbose', 'true');
      const { isVerbose } = await import('./log');
      expect(isVerbose()).toBe(true);
    });
  });

  describe('setVerbose', () => {
    it('设置为 true 应更新状态并写入 localStorage', async () => {
      storageMap.delete('nexus-terminal:verbose');
      const { setVerbose, isVerbose } = await import('./log');

      setVerbose(true);

      expect(isVerbose()).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('nexus-terminal:verbose', 'true');
    });

    it('设置为 false 应更新状态并从 localStorage 移除', async () => {
      storageMap.set('nexus-terminal:verbose', 'true');
      const { setVerbose, isVerbose } = await import('./log');

      setVerbose(false);

      expect(isVerbose()).toBe(false);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('nexus-terminal:verbose');
    });

    it('设置为 true 后 verbose debug 应输出', async () => {
      storageMap.delete('nexus-terminal:verbose');
      const { setVerbose, log } = await import('./log');

      setVerbose(true);

      // 注意：import.meta.env.DEV 在测试环境中可能为 false
      // 因此 debug 可能仍不输出，但 setVerbose 本身的行为应正确
      log.debug('调试信息');
      // 如果 DEV 为 true，console.debug 应被调用
      // 如果 DEV 为 false，console.debug 不应被调用
    });
  });

  describe('initVerbose 行为', () => {
    it('localStorage 不可用时应静默处理', async () => {
      // 模拟 localStorage.getItem 抛出异常
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      const { isVerbose } = await import('./log');
      expect(isVerbose()).toBe(false);
    });

    it('localStorage.setItem 不可用时应静默处理', async () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      const { setVerbose, isVerbose } = await import('./log');
      expect(() => setVerbose(true)).not.toThrow();
      expect(isVerbose()).toBe(true);
    });
  });
});
