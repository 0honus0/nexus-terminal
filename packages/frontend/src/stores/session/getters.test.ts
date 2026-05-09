import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, shallowRef } from 'vue';

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 直接使用真实的 state 模块中的 ref（通过模块级变量）
// getters 模块会从同一个 state 模块读取，所以我们直接操作这些 ref
import { sessions, activeSessionId } from './state';
import { sessionTabs, sessionTabsWithStatus, activeSession } from './getters';
import { log } from '@/utils/log';

// 使用真实的 localStorage mock（全局 setup 中的 localStorage 是空壳 vi.fn()）
// 需要功能正常的 localStorage 来测试 sessionOrder 排序逻辑
const storageMap = new Map<string, string>();
const realLocalStorageMock = {
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

const createMockSession = (overrides: {
  sessionId: string;
  connectionName?: string;
  createdAt?: number;
  isMarkedForSuspend?: boolean;
  wsManager?: { connectionStatus?: { value: string } };
}) => ({
  sessionId: overrides.sessionId,
  connectionId: '1',
  connectionName: overrides.connectionName ?? `会话-${overrides.sessionId}`,
  wsManager: {
    connectionStatus: { value: overrides.wsManager?.connectionStatus?.value ?? 'connected' },
  },
  editorTabs: [],
  activeEditorTabId: null,
  commandInputContent: '',
  createdAt: overrides.createdAt ?? Date.now(),
  isMarkedForSuspend: overrides.isMarkedForSuspend ?? false,
});

/** 设置 sessions 并触发 computed 重算 */
const setSessions = (...sessionList: ReturnType<typeof createMockSession>[]) => {
  const newMap = new Map<string, ReturnType<typeof createMockSession>>();
  sessionList.forEach((s) => newMap.set(s.sessionId, s));
  sessions.value = newMap;
};

describe('session/getters', () => {
  beforeEach(() => {
    // 替换全局 localStorage mock 为功能正常的实现
    Object.defineProperty(window, 'localStorage', {
      value: realLocalStorageMock,
      writable: true,
      configurable: true,
    });
    storageMap.clear();
    realLocalStorageMock.getItem.mockClear();
    realLocalStorageMock.setItem.mockClear();
    realLocalStorageMock.removeItem.mockClear();

    sessions.value = new Map();
    activeSessionId.value = null;
    vi.mocked(log.error).mockClear();
    vi.mocked(log.info).mockClear();
    vi.mocked(log.warn).mockClear();
  });

  describe('sessionTabs', () => {
    it('空 sessions 时应返回空数组', () => {
      expect(sessionTabs.value).toEqual([]);
    });

    it('有会话时应返回 sessionId 和 connectionName 列表', () => {
      const s1 = createMockSession({ sessionId: 's1', connectionName: '服务器A' });
      const s2 = createMockSession({ sessionId: 's2', connectionName: '服务器B' });
      setSessions(s1, s2);

      const tabs = sessionTabs.value;
      expect(tabs).toHaveLength(2);
      expect(tabs).toContainEqual({ sessionId: 's1', connectionName: '服务器A' });
      expect(tabs).toContainEqual({ sessionId: 's2', connectionName: '服务器B' });
    });

    it('单个会话时应返回包含该会话的数组', () => {
      const s1 = createMockSession({ sessionId: 's1', connectionName: '唯一服务器' });
      setSessions(s1);

      expect(sessionTabs.value).toHaveLength(1);
      expect(sessionTabs.value[0].sessionId).toBe('s1');
    });
  });

  describe('sessionTabsWithStatus', () => {
    it('空 sessions 时应返回空数组', () => {
      expect(sessionTabsWithStatus.value).toEqual([]);
    });

    it('应返回包含连接状态的标签列表', () => {
      const s1 = createMockSession({
        sessionId: 's1',
        connectionName: 'A',
        wsManager: { connectionStatus: { value: 'connected' } },
        createdAt: 1000,
      });
      const s2 = createMockSession({
        sessionId: 's2',
        connectionName: 'B',
        wsManager: { connectionStatus: { value: 'disconnected' } },
        createdAt: 2000,
      });
      setSessions(s1, s2);

      const tabs = sessionTabsWithStatus.value;
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toHaveProperty('status');
      expect(tabs[0]).toHaveProperty('isMarkedForSuspend');
    });

    it('没有自定义排序时应按 createdAt 排序', () => {
      const s1 = createMockSession({ sessionId: 's1', createdAt: 3000 });
      const s2 = createMockSession({ sessionId: 's2', createdAt: 1000 });
      const s3 = createMockSession({ sessionId: 's3', createdAt: 2000 });
      setSessions(s1, s2, s3);

      const tabs = sessionTabsWithStatus.value;
      expect(tabs[0].sessionId).toBe('s2');
      expect(tabs[1].sessionId).toBe('s3');
      expect(tabs[2].sessionId).toBe('s1');
    });

    it('有 sessionOrder 时应按自定义顺序排序', () => {
      // localStorage 非响应式，必须在首次读取 computed 前设置
      const s1 = createMockSession({ sessionId: 's1', createdAt: 3000 });
      const s2 = createMockSession({ sessionId: 's2', createdAt: 1000 });
      const s3 = createMockSession({ sessionId: 's3', createdAt: 2000 });
      localStorage.setItem('sessionOrder', JSON.stringify(['s3', 's1', 's2']));
      setSessions(s1, s2, s3);

      const tabs = sessionTabsWithStatus.value;
      expect(tabs[0].sessionId).toBe('s3');
      expect(tabs[1].sessionId).toBe('s1');
      expect(tabs[2].sessionId).toBe('s2');
    });

    it('sessionOrder 中不存在的会话应排在最后', () => {
      const s1 = createMockSession({ sessionId: 's1', createdAt: 1000 });
      const s2 = createMockSession({ sessionId: 's2', createdAt: 2000 });
      localStorage.setItem('sessionOrder', JSON.stringify(['s2']));
      setSessions(s1, s2);

      const tabs = sessionTabsWithStatus.value;
      expect(tabs[0].sessionId).toBe('s2');
      expect(tabs[1].sessionId).toBe('s1');
    });

    it('sessionOrder 中有不存在的会话 ID 应被忽略', () => {
      const s1 = createMockSession({ sessionId: 's1', createdAt: 1000 });
      localStorage.setItem('sessionOrder', JSON.stringify(['s1', 'nonexistent']));
      setSessions(s1);

      const tabs = sessionTabsWithStatus.value;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].sessionId).toBe('s1');
    });

    it('sessionOrder 解析失败时应按 createdAt 排序', () => {
      const s1 = createMockSession({ sessionId: 's1', createdAt: 2000 });
      const s2 = createMockSession({ sessionId: 's2', createdAt: 1000 });
      localStorage.setItem('sessionOrder', 'invalid-json{');
      setSessions(s1, s2);

      const tabs = sessionTabsWithStatus.value;
      expect(tabs[0].sessionId).toBe('s2');
      expect(tabs[1].sessionId).toBe('s1');
    });

    it('isMarkedForSuspend 应正确传递', () => {
      const s1 = createMockSession({ sessionId: 's1', isMarkedForSuspend: true, createdAt: 1000 });
      setSessions(s1);

      const tabs = sessionTabsWithStatus.value;
      expect(tabs[0].isMarkedForSuspend).toBe(true);
    });
  });

  describe('activeSession', () => {
    it('无活动会话 ID 时应返回 null', () => {
      activeSessionId.value = null;
      expect(activeSession.value).toBeNull();
    });

    it('有活动会话 ID 但 sessions 中不存在时应返回 null', () => {
      activeSessionId.value = 'nonexistent';
      expect(activeSession.value).toBeNull();
    });

    it('有活动会话时应返回对应的 SessionState', () => {
      const s1 = createMockSession({ sessionId: 's1', connectionName: '活跃会话' });
      setSessions(s1);
      activeSessionId.value = 's1';

      const session = activeSession.value;
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('s1');
      expect(session!.connectionName).toBe('活跃会话');
    });

    it('切换活动会话 ID 时应返回不同的会话', () => {
      const s1 = createMockSession({ sessionId: 's1', connectionName: 'A' });
      const s2 = createMockSession({ sessionId: 's2', connectionName: 'B' });
      setSessions(s1, s2);

      activeSessionId.value = 's1';
      expect(activeSession.value!.connectionName).toBe('A');

      activeSessionId.value = 's2';
      expect(activeSession.value!.connectionName).toBe('B');
    });
  });
});
