/**
 * RDP WebSocket Handler 单元测试
 * 测试 RDP 代理连接的 WebSocket 消息处理逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import { handleRdpProxyConnection } from './rdp.handler';
import { AuthenticatedWebSocket } from '../types';
import { Request } from 'express';

type MockRdpWs = EventEmitter & {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type RdpProxyRequest = Request & {
  clientIpAddress?: string;
  rdpToken?: string;
  rdpWidth?: string;
  rdpHeight?: string;
};

// 存储 mock RDP WebSocket 实例的引用
let capturedRdpWs: MockRdpWs | null = null;

// Mock ws module for RDP WebSocket connection
vi.mock('ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ws')>();

  // 创建 mock 构造函数并保留静态常量
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const mockRdpWs = new EventEmitter() as MockRdpWs;
    mockRdpWs.readyState = 1; // WebSocket.OPEN = 1
    mockRdpWs.send = vi.fn();
    mockRdpWs.close = vi.fn();
    // 存储引用以便测试访问
    capturedRdpWs = mockRdpWs;
    return mockRdpWs;
  }) as any;

  // 复制原始 WebSocket 的静态常量
  MockWebSocket.CONNECTING = 0;
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSING = 2;
  MockWebSocket.CLOSED = 3;

  return {
    ...actual,
    default: MockWebSocket,
  };
});

// Mock heartbeat module
vi.mock('../heartbeat', () => ({
  resetHeartbeat: vi.fn(),
}));

// Helper to create mock WebSocket
function createMockWebSocket(
  overrides: Partial<AuthenticatedWebSocket> = {}
): AuthenticatedWebSocket {
  const ws = new EventEmitter() as AuthenticatedWebSocket;
  ws.readyState = 1; // WebSocket.OPEN = 1
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.userId = 1;
  ws.username = 'testuser';
  ws.sessionId = 'test-session-123';
  Object.assign(ws, overrides);
  return ws;
}

// Helper to create mock Request
function createMockRequest(overrides: Partial<RdpProxyRequest> = {}): RdpProxyRequest {
  return {
    clientIpAddress: '127.0.0.1',
    rdpToken: 'valid-rdp-token',
    rdpWidth: '1920',
    rdpHeight: '1080',
    ...overrides,
  } as RdpProxyRequest;
}

describe('RDP WebSocket Handler', () => {
  let mockWs: AuthenticatedWebSocket;
  let mockRequest: RdpProxyRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedRdpWs = null;
    mockWs = createMockWebSocket();
    mockRequest = createMockRequest();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('参数验证', () => {
    it('缺少 rdpToken 时应发送错误并关闭连接', () => {
      mockRequest = createMockRequest({ rdpToken: undefined });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'rdp:error',
          payload: 'Missing RDP connection parameters (token, width, height).',
        })
      );
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Missing RDP parameters');
    });

    it('缺少 rdpWidth 时应发送错误并关闭连接', () => {
      mockRequest = createMockRequest({ rdpWidth: undefined });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'rdp:error',
          payload: 'Missing RDP connection parameters (token, width, height).',
        })
      );
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Missing RDP parameters');
    });

    it('缺少 rdpHeight 时应发送错误并关闭连接', () => {
      mockRequest = createMockRequest({ rdpHeight: undefined });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'rdp:error',
          payload: 'Missing RDP connection parameters (token, width, height).',
        })
      );
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Missing RDP parameters');
    });

    it('rdpWidth 为无效值时应发送错误', () => {
      mockRequest = createMockRequest({ rdpWidth: 'invalid' });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'rdp:error', payload: 'Invalid width or height parameters.' })
      );
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid RDP dimensions');
    });

    it('rdpHeight 为负数时应发送错误', () => {
      mockRequest = createMockRequest({ rdpHeight: '-100' });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'rdp:error', payload: 'Invalid width or height parameters.' })
      );
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid RDP dimensions');
    });

    it('rdpWidth 为零时应发送错误', () => {
      mockRequest = createMockRequest({ rdpWidth: '0' });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'rdp:error', payload: 'Invalid width or height parameters.' })
      );
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid RDP dimensions');
    });
  });

  describe('DPI 计算', () => {
    it('宽度 > 1920 时应使用 DPI=120', () => {
      mockRequest = createMockRequest({ rdpWidth: '2560', rdpHeight: '1440' });

      handleRdpProxyConnection(mockWs, mockRequest);

      // 验证 WebSocket URL 包含 dpi=120
      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('dpi=120'));
    });

    it('宽度 <= 1920 时应使用 DPI=96', () => {
      mockRequest = createMockRequest({ rdpWidth: '1920', rdpHeight: '1080' });

      handleRdpProxyConnection(mockWs, mockRequest);

      // 验证 WebSocket URL 包含 dpi=96
      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('dpi=96'));
    });

    it('宽度 = 1280 时应使用 DPI=96', () => {
      mockRequest = createMockRequest({ rdpWidth: '1280', rdpHeight: '720' });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('dpi=96'));
    });
  });

  describe('部署模式', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('local 模式应使用本地 URL', () => {
      process.env = { ...originalEnv, DEPLOYMENT_MODE: 'local' };

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('ws://localhost:8080'));
    });

    it('docker 模式应使用 remote-gateway URL', () => {
      process.env = { ...originalEnv, DEPLOYMENT_MODE: 'docker' };

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('ws://remote-gateway:8080'));
    });

    it('自定义 local URL 应覆盖默认值', () => {
      process.env = {
        ...originalEnv,
        DEPLOYMENT_MODE: 'local',
        REMOTE_GATEWAY_WS_URL_LOCAL: 'ws://custom-local:9999',
      };

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('ws://custom-local:9999'));
    });

    it('自定义 docker URL 应覆盖默认值', () => {
      process.env = {
        ...originalEnv,
        DEPLOYMENT_MODE: 'docker',
        REMOTE_GATEWAY_WS_URL_DOCKER: 'ws://custom-docker:7777',
      };

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('ws://custom-docker:7777'));
    });

    it('未知部署模式应使用默认 localhost', () => {
      process.env = { ...originalEnv, DEPLOYMENT_MODE: 'unknown' };

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('ws://localhost:8080'));
    });
  });

  describe('消息转发', () => {
    it('应转发客户端消息到 RDP WebSocket', () => {
      handleRdpProxyConnection(mockWs, mockRequest);

      const testMessage = Buffer.from('client message');
      mockWs.emit('message', testMessage);

      expect(capturedRdpWs.send).toHaveBeenCalledWith(testMessage);
    });

    it('RDP WebSocket 未打开时应丢弃客户端消息', () => {
      handleRdpProxyConnection(mockWs, mockRequest);
      // 先清除之前的调用记录
      (capturedRdpWs.send as any).mockClear();
      // 修改状态后再发送消息 (3 = WebSocket.CLOSED)
      capturedRdpWs.readyState = 3;

      const testMessage = Buffer.from('client message');
      mockWs.emit('message', testMessage);

      // 消息应该被丢弃，send 应该没有被调用
      expect(capturedRdpWs.send).not.toHaveBeenCalled();
    });

    it('应转发 RDP 消息到客户端 WebSocket', () => {
      handleRdpProxyConnection(mockWs, mockRequest);

      const testMessage = Buffer.from('rdp response');
      capturedRdpWs.emit('message', testMessage);

      expect(mockWs.send).toHaveBeenCalledWith('rdp response');
    });

    it('客户端 WebSocket 未打开时应丢弃 RDP 消息', () => {
      handleRdpProxyConnection(mockWs, mockRequest);
      // 先清除之前的调用记录
      (mockWs.send as any).mockClear();
      // 修改状态后再发送消息 (3 = WebSocket.CLOSED)
      mockWs.readyState = 3;

      const testMessage = Buffer.from('rdp response');
      capturedRdpWs.emit('message', testMessage);

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('客户端 WebSocket 错误应关闭 RDP WebSocket', () => {
      handleRdpProxyConnection(mockWs, mockRequest);

      mockWs.emit('error', new Error('Client connection error'));

      expect(capturedRdpWs.close).toHaveBeenCalledWith(1011, 'Client WS Error');
    });

    it('RDP WebSocket 错误应关闭客户端 WebSocket', () => {
      handleRdpProxyConnection(mockWs, mockRequest);

      capturedRdpWs.emit('error', new Error('RDP connection failed'));

      expect(mockWs.close).toHaveBeenCalledWith(1011, 'RDP WS Error: RDP connection failed');
    });

    it('RDP WebSocket 已关闭时客户端错误不应尝试关闭 RDP', () => {
      handleRdpProxyConnection(mockWs, mockRequest);
      // 3 = WebSocket.CLOSED
      capturedRdpWs.readyState = 3;

      mockWs.emit('error', new Error('Client error'));

      expect(capturedRdpWs.close).not.toHaveBeenCalled();
    });

    it('客户端 WebSocket 已关闭时 RDP 错误不应尝试关闭客户端', () => {
      handleRdpProxyConnection(mockWs, mockRequest);
      // 3 = WebSocket.CLOSED
      mockWs.readyState = 3;

      capturedRdpWs.emit('error', new Error('RDP error'));

      // close 不应被调用
      expect(mockWs.close).not.toHaveBeenCalled();
    });
  });

  describe('关闭处理', () => {
    it('客户端关闭应关闭 RDP WebSocket', () => {
      handleRdpProxyConnection(mockWs, mockRequest);

      mockWs.emit('close', 1000, Buffer.from('Normal closure'));

      expect(capturedRdpWs.close).toHaveBeenCalledWith(1000, 'Client WS Closed');
    });

    it('RDP 关闭应关闭客户端 WebSocket', () => {
      handleRdpProxyConnection(mockWs, mockRequest);

      capturedRdpWs.emit('close', 1000, Buffer.from('Normal closure'));

      expect(mockWs.close).toHaveBeenCalledWith(1000, 'RDP WS Closed');
    });

    it('RDP WebSocket 已关闭时客户端关闭不应尝试关闭 RDP', () => {
      handleRdpProxyConnection(mockWs, mockRequest);
      // 3 = WebSocket.CLOSED
      capturedRdpWs.readyState = 3;

      mockWs.emit('close', 1000, Buffer.from('Normal closure'));

      expect(capturedRdpWs.close).not.toHaveBeenCalled();
    });

    it('客户端 WebSocket 已关闭时 RDP 关闭不应尝试关闭客户端', () => {
      handleRdpProxyConnection(mockWs, mockRequest);
      // 3 = WebSocket.CLOSED
      mockWs.readyState = 3;

      capturedRdpWs.emit('close', 1000, Buffer.from('Normal closure'));

      expect(mockWs.close).not.toHaveBeenCalled();
    });
  });

  describe('心跳机制', () => {
    it('pong 事件应重置心跳', async () => {
      const { resetHeartbeat } = await import('../heartbeat');

      handleRdpProxyConnection(mockWs, mockRequest);

      mockWs.emit('pong');

      expect(resetHeartbeat).toHaveBeenCalledWith(mockWs);
    });
  });

  describe('URL 构建', () => {
    it('应正确编码 URL 参数', () => {
      mockRequest = createMockRequest({ rdpToken: 'token with spaces' });

      handleRdpProxyConnection(mockWs, mockRequest);

      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('token=token%20with%20spaces')
      );
    });

    it('应移除 baseUrl 尾部斜杠', () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        DEPLOYMENT_MODE: 'local',
        REMOTE_GATEWAY_WS_URL_LOCAL: 'ws://localhost:8080/',
      };

      handleRdpProxyConnection(mockWs, mockRequest);

      // 验证 URL 不包含双斜杠
      expect(WebSocket).toHaveBeenCalledWith(expect.not.stringContaining('8080//'));

      process.env = originalEnv;
    });

    it('URL 应包含所有必要参数', () => {
      mockRequest = createMockRequest({
        rdpToken: 'test-token',
        rdpWidth: '1920',
        rdpHeight: '1080',
      });

      handleRdpProxyConnection(mockWs, mockRequest);

      const wsCall = (WebSocket as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(wsCall).toContain('token=test-token');
      expect(wsCall).toContain('width=1920');
      expect(wsCall).toContain('height=1080');
      expect(wsCall).toContain('dpi=96');
    });
  });
});
