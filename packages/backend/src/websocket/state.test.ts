/**
 * WebSocket 状态管理单元测试
 * 测试客户端连接状态、用户 Socket 管理和广播功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';

// Mock 依赖
vi.mock('../sftp/sftp.service', () => ({
  SftpService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../services/status-monitor.service', () => ({
  StatusMonitorService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../audit/audit.service', () => ({
  AuditLogService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../notifications/notification.service', () => ({
  NotificationService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../docker/docker.service', () => ({
  DockerService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../settings/settings.service', () => ({
  settingsService: {},
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('WebSocket 状态管理', () => {
  let clientStates: Map<string, any>;
  let userSockets: Map<number, Set<unknown>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 动态导入以获取干净的状态
    const state = await import('./state');
    clientStates = state.clientStates;
    userSockets = state.userSockets;
    clientStates.clear();
    userSockets.clear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('clientStates', () => {
    it('应是一个 Map 实例', async () => {
      const state = await import('./state');
      expect(state.clientStates).toBeInstanceOf(Map);
    });

    it('应支持添加和获取客户端状态', () => {
      clientStates.set('session-1', {
        ws: {},
        userId: 1,
        connected: true,
      });

      expect(clientStates.has('session-1')).toBe(true);
      expect(clientStates.get('session-1').userId).toBe(1);
    });

    it('应支持删除客户端状态', () => {
      clientStates.set('session-1', { connected: true });
      clientStates.delete('session-1');

      expect(clientStates.has('session-1')).toBe(false);
    });
  });

  describe('acquireSessionLock', () => {
    it('应返回 lock 和 release 函数', async () => {
      const { acquireSessionLock } = await import('./state');

      const result = acquireSessionLock('session-1');

      expect(result).toHaveProperty('lock');
      expect(result).toHaveProperty('release');
      expect(typeof result.release).toBe('function');
      expect(result.lock).toBeInstanceOf(Promise);

      // 清理
      result.release();
    });

    it('release 函数应可调用', async () => {
      const { acquireSessionLock } = await import('./state');

      const lock = acquireSessionLock('session-1');

      // release 不应抛出错误
      expect(() => lock.release()).not.toThrow();
    });

    it('不同 sessionId 的锁应互不影响', async () => {
      const { acquireSessionLock } = await import('./state');

      const lock1 = acquireSessionLock('session-1');
      const lock2 = acquireSessionLock('session-2');

      // 两个锁都应有独立的 lock 和 release
      expect(lock1).toHaveProperty('lock');
      expect(lock1).toHaveProperty('release');
      expect(lock2).toHaveProperty('lock');
      expect(lock2).toHaveProperty('release');

      lock1.release();
      lock2.release();
    });
  });

  describe('registerUserSocket', () => {
    it('应注册用户 WebSocket 连接', async () => {
      const { registerUserSocket } = await import('./state');
      const mockWs = { readyState: WebSocket.OPEN } as unknown;

      registerUserSocket(1, mockWs);

      expect(userSockets.has(1)).toBe(true);
      expect(userSockets.get(1)!.size).toBe(1);
    });

    it('应支持同一用户多个连接', async () => {
      const { registerUserSocket } = await import('./state');
      const mockWs1 = { readyState: WebSocket.OPEN } as unknown;
      const mockWs2 = { readyState: WebSocket.OPEN } as unknown;

      registerUserSocket(1, mockWs1);
      registerUserSocket(1, mockWs2);

      expect(userSockets.get(1)!.size).toBe(2);
    });
  });

  describe('unregisterUserSocket', () => {
    it('应注销用户 WebSocket 连接', async () => {
      const { registerUserSocket, unregisterUserSocket } = await import('./state');
      const mockWs = { readyState: WebSocket.OPEN } as unknown;

      registerUserSocket(1, mockWs);
      expect(userSockets.get(1)!.size).toBe(1);

      unregisterUserSocket(1, mockWs);
      expect(userSockets.has(1)).toBe(false);
    });

    it('应支持断开部分连接', async () => {
      const { registerUserSocket, unregisterUserSocket } = await import('./state');
      const mockWs1 = { readyState: WebSocket.OPEN } as unknown;
      const mockWs2 = { readyState: WebSocket.OPEN } as unknown;

      registerUserSocket(1, mockWs1);
      registerUserSocket(1, mockWs2);

      unregisterUserSocket(1, mockWs1);

      expect(userSockets.get(1)!.size).toBe(1);
    });

    it('用户不存在时应安全处理', async () => {
      const { unregisterUserSocket } = await import('./state');
      const mockWs = { readyState: WebSocket.OPEN } as unknown;

      // 不应抛出错误
      expect(() => unregisterUserSocket(999, mockWs)).not.toThrow();
    });
  });

  describe('broadcastToUser', () => {
    it('应向用户的所有连接广播消息', async () => {
      const { registerUserSocket, broadcastToUser } = await import('./state');
      const mockWs1 = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown;
      const mockWs2 = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown;

      registerUserSocket(1, mockWs1);
      registerUserSocket(1, mockWs2);

      const count = broadcastToUser(1, { type: 'test', data: 'hello' });

      expect(count).toBe(2);
      expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'hello' }));
      expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'hello' }));
    });

    it('用户无连接时应返回 0', async () => {
      const { broadcastToUser } = await import('./state');

      const count = broadcastToUser(999, { type: 'test' });

      expect(count).toBe(0);
    });

    it('应清理死连接', async () => {
      const { registerUserSocket, broadcastToUser } = await import('./state');
      const mockWs = {
        readyState: WebSocket.CLOSED,
        send: vi.fn(),
      } as unknown;

      registerUserSocket(1, mockWs);

      const count = broadcastToUser(1, { type: 'test' });

      expect(count).toBe(0);
      // 死连接应被清理
      expect(userSockets.has(1)).toBe(false);
    });

    it('应处理发送失败的连接', async () => {
      const { registerUserSocket, broadcastToUser } = await import('./state');
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn().mockImplementation(() => {
          throw new Error('Send failed');
        }),
      } as unknown;

      registerUserSocket(1, mockWs);

      const count = broadcastToUser(1, { type: 'test' });

      expect(count).toBe(0);
    });
  });
});
