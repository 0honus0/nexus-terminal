import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../composables/useWebSocketConnection', () => ({
  createWebSocketConnectionManager: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendMessage: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
    isConnected: ref(true),
    isSftpReady: ref(true),
    connectionStatus: ref('connected'),
  })),
}));

vi.mock('../../../composables/useSshTerminal', () => ({
  createSshTerminalManager: vi.fn(() => ({
    cleanup: vi.fn(),
  })),
}));

vi.mock('../../../composables/useStatusMonitor', () => ({
  createStatusMonitorManager: vi.fn(() => ({
    cleanup: vi.fn(),
  })),
}));

vi.mock('../../../composables/useDockerManager', () => ({
  createDockerManager: vi.fn(() => ({
    cleanup: vi.fn(),
  })),
}));

vi.mock('../../../composables/workspaceEvents', () => ({
  workspaceEmitter: {
    emit: vi.fn(),
  },
}));

vi.mock('../utils', () => ({
  generateSessionId: vi.fn(() => 'mock-session-id'),
}));

vi.mock('../sshSuspendActions', () => ({
  registerSshSuspendHandlers: vi.fn(),
}));

const { mockSessions, mockActiveSessionId } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vue = require('vue') as typeof import('vue');
  return {
    mockSessions: vue.shallowRef<Map<string, any>>(new Map()),
    mockActiveSessionId: vue.ref<string | null>(null),
  };
});

vi.mock('../state', () => ({
  sessions: mockSessions,
  activeSessionId: mockActiveSessionId,
}));

import {
  activateSession,
  closeSession,
  cleanupAllSessions,
  handleConnectRequest,
  openNewSession,
} from './sessionActions';
import { log } from '@/utils/log';
import { workspaceEmitter } from '../../../composables/workspaceEvents';
import { createWebSocketConnectionManager } from '../../../composables/useWebSocketConnection';

/** 创建模拟会话（完整 SessionState 结构） */
const createMockSession = (
  sessionId: string,
  overrides: { connectionId?: string; connectionName?: string; isMarkedForSuspend?: boolean } = {}
) => ({
  sessionId,
  connectionId: overrides.connectionId ?? '1',
  connectionName: overrides.connectionName ?? `会话-${sessionId}`,
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendMessage: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
    isConnected: ref(true),
    isSftpReady: ref(true),
    connectionStatus: ref('connected'),
  },
  sftpManagers: new Map(),
  terminalManager: { cleanup: vi.fn() },
  statusMonitorManager: { cleanup: vi.fn() },
  dockerManager: { cleanup: vi.fn() },
  editorTabs: ref([]),
  activeEditorTabId: ref(null),
  commandInputContent: ref(''),
  isMarkedForSuspend: overrides.isMarkedForSuspend ?? false,
  createdAt: Date.now(),
  disposables: [],
});

describe('session/actions/sessionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessions.value.clear();
    mockActiveSessionId.value = null;
  });

  describe('activateSession', () => {
    it('会话存在时应设置 activeSessionId', () => {
      mockSessions.value.set('s1', createMockSession('s1'));

      activateSession('s1');

      expect(mockActiveSessionId.value).toBe('s1');
    });

    it('会话已激活时不应重复设置', () => {
      mockSessions.value.set('s1', createMockSession('s1'));
      mockActiveSessionId.value = 's1';

      activateSession('s1');

      expect(mockActiveSessionId.value).toBe('s1');
    });

    it('会话不存在时应输出警告日志', () => {
      activateSession('nonexistent');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的会话'));
    });

    it('切换到不同会话时应更新 activeSessionId', () => {
      mockSessions.value.set('s1', createMockSession('s1'));
      mockSessions.value.set('s2', createMockSession('s2'));
      mockActiveSessionId.value = 's1';

      activateSession('s2');

      expect(mockActiveSessionId.value).toBe('s2');
    });
  });

  describe('closeSession', () => {
    it('会话不存在时应输出警告日志', () => {
      closeSession('nonexistent');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('不存在的会话'));
    });

    it('应调用 wsManager.disconnect()', () => {
      const session = createMockSession('s1');
      mockSessions.value.set('s1', session);

      closeSession('s1');

      expect(session.wsManager.disconnect).toHaveBeenCalled();
    });

    it('应清理所有 sftpManagers', () => {
      const session = createMockSession('s1');
      const manager1 = { cleanup: vi.fn() };
      const manager2 = { cleanup: vi.fn() };
      session.sftpManagers.set('i1', manager1 as never);
      session.sftpManagers.set('i2', manager2 as never);
      mockSessions.value.set('s1', session);

      closeSession('s1');

      expect(manager1.cleanup).toHaveBeenCalled();
      expect(manager2.cleanup).toHaveBeenCalled();
      expect(session.sftpManagers.size).toBe(0);
    });

    it('应调用 terminalManager.cleanup()', () => {
      const session = createMockSession('s1');
      mockSessions.value.set('s1', session);

      closeSession('s1');

      expect(session.terminalManager.cleanup).toHaveBeenCalled();
    });

    it('应调用 statusMonitorManager.cleanup()', () => {
      const session = createMockSession('s1');
      mockSessions.value.set('s1', session);

      closeSession('s1');

      expect(session.statusMonitorManager.cleanup).toHaveBeenCalled();
    });

    it('应调用 dockerManager.cleanup()', () => {
      const session = createMockSession('s1');
      mockSessions.value.set('s1', session);

      closeSession('s1');

      expect(session.dockerManager.cleanup).toHaveBeenCalled();
    });

    it('应执行所有 disposables', () => {
      const session = createMockSession('s1');
      const dispose1 = vi.fn();
      const dispose2 = vi.fn();
      session.disposables = [dispose1, dispose2];
      mockSessions.value.set('s1', session);

      closeSession('s1');

      expect(dispose1).toHaveBeenCalled();
      expect(dispose2).toHaveBeenCalled();
      expect(session.disposables).toEqual([]);
    });

    it('disposable 执行出错时不应抛出异常', () => {
      const session = createMockSession('s1');
      session.disposables = [
        vi.fn(() => {
          throw new Error('清理失败');
        }),
      ];
      mockSessions.value.set('s1', session);

      expect(() => closeSession('s1')).not.toThrow();
      expect(log.error).toHaveBeenCalled();
    });

    it('应从 sessions Map 中移除会话', () => {
      mockSessions.value.set('s1', createMockSession('s1'));

      closeSession('s1');

      expect(mockSessions.value.has('s1')).toBe(false);
    });

    it('关闭活动会话后应切换到最后一个剩余会话', () => {
      const s1 = createMockSession('s1');
      const s2 = createMockSession('s2');
      mockSessions.value.set('s1', s1);
      mockSessions.value.set('s2', s2);
      mockActiveSessionId.value = 's1';

      closeSession('s1');

      expect(mockActiveSessionId.value).toBe('s2');
    });

    it('关闭最后一个会话后 activeSessionId 应为 null', () => {
      mockSessions.value.set('s1', createMockSession('s1'));
      mockActiveSessionId.value = 's1';

      closeSession('s1');

      expect(mockActiveSessionId.value).toBeNull();
    });

    it('关闭非活动会话不应改变 activeSessionId', () => {
      const s1 = createMockSession('s1');
      const s2 = createMockSession('s2');
      mockSessions.value.set('s1', s1);
      mockSessions.value.set('s2', s2);
      mockActiveSessionId.value = 's1';

      closeSession('s2');

      expect(mockActiveSessionId.value).toBe('s1');
      expect(mockSessions.value.has('s2')).toBe(false);
    });
  });

  describe('cleanupAllSessions', () => {
    it('无会话时不应抛出异常', () => {
      expect(() => cleanupAllSessions()).not.toThrow();
      expect(mockActiveSessionId.value).toBeNull();
    });

    it('应关闭所有会话', () => {
      const s1 = createMockSession('s1');
      const s2 = createMockSession('s2');
      mockSessions.value.set('s1', s1);
      mockSessions.value.set('s2', s2);
      mockActiveSessionId.value = 's1';

      cleanupAllSessions();

      expect(s1.wsManager.disconnect).toHaveBeenCalled();
      expect(s2.wsManager.disconnect).toHaveBeenCalled();
      expect(mockSessions.value.size).toBe(0);
      expect(mockActiveSessionId.value).toBeNull();
    });
  });

  describe('handleConnectRequest', () => {
    const createMockConnection = (
      overrides: { type?: string; id?: number; name?: string; host?: string } = {}
    ) => ({
      id: overrides.id ?? 1,
      name: overrides.name ?? '测试连接',
      type: overrides.type ?? 'SSH',
      host: overrides.host ?? '192.168.1.1',
      port: 22,
      username: 'root',
      auth_method: 'password' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      last_connected_at: null,
    });

    const createMockDependencies = () => ({
      connectionsStore: {
        connections: [],
      },
      router: {
        push: vi.fn(),
      },
      openRdpModalAction: vi.fn(),
      openVncModalAction: vi.fn(),
      t: (key: string, fallback?: string) => fallback ?? key,
    });

    it('RDP 连接应打开 RDP Modal', () => {
      const conn = createMockConnection({ type: 'RDP' });
      const deps = createMockDependencies();

      handleConnectRequest(conn as any, deps as any);

      expect(deps.openRdpModalAction).toHaveBeenCalledWith(conn);
      expect(deps.openVncModalAction).not.toHaveBeenCalled();
    });

    it('VNC 连接应打开 VNC Modal', () => {
      const conn = createMockConnection({ type: 'VNC' });
      const deps = createMockDependencies();

      handleConnectRequest(conn as any, deps as any);

      expect(deps.openVncModalAction).toHaveBeenCalledWith(conn);
      expect(deps.openRdpModalAction).not.toHaveBeenCalled();
    });

    it('SSH 连接无活动会话时应打开新会话', () => {
      const conn = createMockConnection({ type: 'SSH', id: 42 });
      const deps = createMockDependencies();

      handleConnectRequest(conn as any, deps as any);

      expect(deps.router.push).toHaveBeenCalledWith({ name: 'Workspace' });
    });

    it('SSH 连接且活动会话已断开时应尝试重连', () => {
      const session = createMockSession('s1', { connectionId: '1' });
      session.wsManager.connectionStatus = ref('disconnected');
      mockSessions.value.set('s1', session);
      mockActiveSessionId.value = 's1';

      const conn = createMockConnection({ type: 'SSH', id: 1 });
      const deps = createMockDependencies();

      handleConnectRequest(conn as any, deps as any);

      expect(session.wsManager.connect).toHaveBeenCalled();
      expect(deps.router.push).toHaveBeenCalledWith({ name: 'Workspace' });
    });
  });

  describe('openNewSession', () => {
    const createMockConnection = (
      overrides: { id?: number; name?: string; host?: string; type?: string } = {}
    ) => ({
      id: overrides.id ?? 1,
      name: overrides.name ?? '测试连接',
      type: overrides.type ?? 'SSH',
      host: overrides.host ?? '192.168.1.1',
      port: 22,
      username: 'root',
      auth_method: 'password' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      last_connected_at: null,
    });

    const createMockDependencies = () => ({
      connectionsStore: {
        connections: [],
      },
      t: (key: string, fallback?: string) => fallback ?? key,
      showError: vi.fn(),
    });

    it('连接不存在时应调用 showError', () => {
      const deps = createMockDependencies();

      openNewSession(999, deps as any);

      expect(deps.showError).toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('找不到'));
    });

    it('传入 ConnectionInfo 对象时应创建新会话', () => {
      const conn = createMockConnection({ id: 1 });
      const deps = createMockDependencies();

      openNewSession(conn as any, deps as any);

      expect(mockSessions.value.size).toBe(1);
      expect(mockActiveSessionId.value).toBeTruthy();
      expect(createWebSocketConnectionManager).toHaveBeenCalled();
    });

    it('传入连接 ID 时应从 connectionsStore 查找', () => {
      const conn = createMockConnection({ id: 1 });
      const deps = createMockDependencies();
      deps.connectionsStore.connections = [conn as any];

      openNewSession(1, deps as any);

      expect(mockSessions.value.size).toBe(1);
    });

    it('传入预定义 sessionId 时应使用该 ID', () => {
      const conn = createMockConnection({ id: 1 });
      const deps = createMockDependencies();

      openNewSession(conn as any, deps as any, 'custom-id');

      expect(mockSessions.value.has('custom-id')).toBe(true);
      expect(mockActiveSessionId.value).toBe('custom-id');
    });

    it('应注册 ssh:connected 消息处理器', () => {
      const conn = createMockConnection({ id: 1 });
      const deps = createMockDependencies();

      openNewSession(conn as any, deps as any);

      const wsManager = vi.mocked(createWebSocketConnectionManager).mock.results[0].value;
      expect(wsManager.onMessage).toHaveBeenCalledWith('ssh:connected', expect.any(Function));
    });

    it('应启动 WebSocket 连接', () => {
      const conn = createMockConnection({ id: 1 });
      const deps = createMockDependencies();

      openNewSession(conn as any, deps as any);

      const wsManager = vi.mocked(createWebSocketConnectionManager).mock.results[0].value;
      expect(wsManager.connect).toHaveBeenCalled();
    });

    it('会话应包含所有必要的管理器', () => {
      const conn = createMockConnection({ id: 1 });
      const deps = createMockDependencies();

      openNewSession(conn as any, deps as any);

      const session = Array.from(mockSessions.value.values())[0];
      expect(session.terminalManager).toBeDefined();
      expect(session.statusMonitorManager).toBeDefined();
      expect(session.dockerManager).toBeDefined();
      expect(session.sftpManagers).toBeInstanceOf(Map);
      expect(session.editorTabs).toBeDefined();
      expect(session.activeEditorTabId).toBeDefined();
    });
  });
});
