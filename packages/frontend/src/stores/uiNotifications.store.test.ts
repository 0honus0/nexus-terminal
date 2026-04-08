import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const loadStoreModule = async () => {
  vi.resetModules();
  return import('./uiNotifications.store');
};

describe('uiNotifications.store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('回归：未配置 VITE_NOTIFICATION_TIMEOUT_MS 时应回退默认超时', async () => {
    vi.stubEnv('VITE_NOTIFICATION_TIMEOUT_MS', '');
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.addNotification({ type: 'info', message: 'hello' });
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]?.timeout).toBe(mod.DEFAULT_NOTIFICATION_TIMEOUT_MS);

    vi.advanceTimersByTime(mod.DEFAULT_NOTIFICATION_TIMEOUT_MS - 1);
    expect(store.notifications).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(store.notifications).toHaveLength(0);
  });

  it('应按清理策略删除过期去重缓存记录', async () => {
    const mod = await loadStoreModule();
    const dedupeCache = new Map<string, number>([
      ['error:a', 0],
      ['error:b', 10_000],
      ['error:c', 70_000],
    ]);

    const removed = mod.pruneExpiredNotificationKeys(dedupeCache, 80_000, mod.DEDUPE_WINDOW_MS);

    expect(removed).toBe(2);
    expect(dedupeCache.has('error:a')).toBe(false);
    expect(dedupeCache.has('error:b')).toBe(false);
    expect(dedupeCache.has('error:c')).toBe(true);
  });
});
