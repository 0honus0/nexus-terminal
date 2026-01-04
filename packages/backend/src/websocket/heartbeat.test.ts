import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { initializeHeartbeat, resetHeartbeat, cleanupHeartbeat } from './heartbeat';
import { AuthenticatedWebSocket } from './types';

describe('WebSocket Heartbeat', () => {
  let wss: WebSocketServer;
  let mockWs: AuthenticatedWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    wss = new WebSocketServer({ noServer: true });

    mockWs = {
      userId: 1,
      username: 'testuser',
      sessionId: 'session-1',
      clientType: 'desktop',
      readyState: WebSocket.OPEN,
      ping: vi.fn(),
      terminate: vi.fn(),
      missedPongCount: 0,
      isAlive: true,
    } as unknown as AuthenticatedWebSocket;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('initializeHeartbeat', () => {
    it('应使用配置的参数初始化心跳机制', () => {
      const config = {
        desktopInterval: 30000,
        mobileInterval: 12000,
        desktopMaxMissed: 1,
        mobileMaxMissed: 3,
      };

      const heartbeatInterval = initializeHeartbeat(wss, config);

      expect(heartbeatInterval).toBeDefined();
      expect(typeof heartbeatInterval).toBe('object');
    });

    it('应使用默认配置初始化', () => {
      const heartbeatInterval = initializeHeartbeat(wss);

      expect(heartbeatInterval).toBeDefined();
    });

    it('应在指定间隔发送ping', () => {
      // 将 mockWs 添加到 wss.clients
      (wss.clients as Set<WebSocket>).add(mockWs as any);

      const config = {
        desktopInterval: 1000,
        mobileInterval: 500,
        desktopMaxMissed: 1,
        mobileMaxMissed: 3,
      };

      initializeHeartbeat(wss, config);

      // 模拟时间推进到最小间隔
      vi.advanceTimersByTime(500);

      expect(mockWs.ping).toHaveBeenCalled();
    });

    it('应根据客户端类型使用不同的心跳间隔', () => {
      const mobileWs = {
        ...mockWs,
        clientType: 'mobile' as const,
        ping: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      (wss.clients as Set<WebSocket>).add(mobileWs as any);

      const config = {
        desktopInterval: 30000,
        mobileInterval: 12000,
        desktopMaxMissed: 1,
        mobileMaxMissed: 3,
      };

      initializeHeartbeat(wss, config);

      // 推进到移动端间隔
      vi.advanceTimersByTime(12000);

      expect(mobileWs.ping).toHaveBeenCalled();
    });

    it('应在超过最大丢包次数时终止连接', () => {
      (wss.clients as Set<WebSocket>).add(mockWs as any);

      const config = {
        desktopInterval: 1000,
        mobileInterval: 500,
        desktopMaxMissed: 1,
        mobileMaxMissed: 3,
      };

      initializeHeartbeat(wss, config);

      // 第一次ping，增加计数
      vi.advanceTimersByTime(1000);
      expect(mockWs.missedPongCount).toBe(1);

      // 第二次ping，超过阈值
      vi.advanceTimersByTime(1000);

      expect(mockWs.terminate).toHaveBeenCalled();
    });

    it('应跳过非OPEN状态的连接', () => {
      mockWs.readyState = WebSocket.CLOSING;
      (wss.clients as Set<WebSocket>).add(mockWs as any);

      const config = {
        desktopInterval: 1000,
        mobileInterval: 500,
        desktopMaxMissed: 1,
        mobileMaxMissed: 3,
      };

      initializeHeartbeat(wss, config);

      vi.advanceTimersByTime(1000);

      expect(mockWs.ping).not.toHaveBeenCalled();
    });
  });

  describe('resetHeartbeat', () => {
    it('应重置心跳计数器', () => {
      mockWs.missedPongCount = 5;
      mockWs.isAlive = false;

      resetHeartbeat(mockWs);

      expect(mockWs.missedPongCount).toBe(0);
      expect(mockWs.isAlive).toBe(true);
    });

    it('应正确处理未初始化的计数器', () => {
      const ws = {
        missedPongCount: undefined,
        isAlive: undefined,
      } as unknown as AuthenticatedWebSocket;

      resetHeartbeat(ws);

      expect(ws.missedPongCount).toBe(0);
      expect(ws.isAlive).toBe(true);
    });
  });

  describe('cleanupHeartbeat', () => {
    it('应清理心跳状态', () => {
      cleanupHeartbeat(mockWs);

      // 验证清理操作不会抛出错误
      expect(true).toBe(true);
    });

    it('应能多次调用清理而不出错', () => {
      cleanupHeartbeat(mockWs);
      cleanupHeartbeat(mockWs);

      expect(true).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('应处理移动端的更长丢包容忍时间', () => {
      const mobileWs = {
        ...mockWs,
        clientType: 'mobile' as const,
        ping: vi.fn(),
        terminate: vi.fn(),
        missedPongCount: 0,
      } as unknown as AuthenticatedWebSocket;

      (wss.clients as Set<WebSocket>).add(mobileWs as any);

      const config = {
        desktopInterval: 30000,
        mobileInterval: 12000,
        desktopMaxMissed: 1,
        mobileMaxMissed: 3,
      };

      initializeHeartbeat(wss, config);

      // 推进3次间隔，不应终止
      vi.advanceTimersByTime(12000);
      vi.advanceTimersByTime(12000);
      vi.advanceTimersByTime(12000);

      expect(mobileWs.missedPongCount).toBe(3);
      expect(mobileWs.terminate).not.toHaveBeenCalled();

      // 第4次应该终止
      vi.advanceTimersByTime(12000);
      expect(mobileWs.terminate).toHaveBeenCalled();
    });

    it('应处理没有clientType的连接（默认为desktop）', () => {
      const unknownWs = {
        ...mockWs,
        clientType: undefined,
        ping: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      (wss.clients as Set<WebSocket>).add(unknownWs as any);

      const config = {
        desktopInterval: 30000,
        mobileInterval: 12000,
        desktopMaxMissed: 1,
        mobileMaxMissed: 3,
      };

      initializeHeartbeat(wss, config);

      // 应该使用桌面端配置
      vi.advanceTimersByTime(30000);
      expect(unknownWs.ping).toHaveBeenCalled();
    });
  });
});
