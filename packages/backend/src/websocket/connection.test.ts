import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { initializeConnectionHandler } from './connection';
import { AuthenticatedWebSocket } from './types';
import { handleSshExecSilent } from './handlers/ssh.handler';
import { registerUserSocket } from './state';

vi.mock('./handlers/ssh.handler', () => ({
  handleSshConnect: vi.fn(),
  handleSshInput: vi.fn(),
  handleSshResize: vi.fn(),
  handleSshResumeSuccess: vi.fn(),
  handleSshExecSilent: vi.fn(),
}));

vi.mock('./handlers/docker.handler', () => ({
  handleDockerGetStatus: vi.fn(),
  handleDockerCommand: vi.fn(),
  handleDockerGetStats: vi.fn(),
}));

vi.mock('./handlers/sftp.handler', () => ({
  handleSftpOperation: vi.fn(),
  handleSftpUploadStart: vi.fn(),
  handleSftpUploadChunk: vi.fn(),
  handleSftpUploadCancel: vi.fn(),
}));

vi.mock('./handlers/rdp.handler', () => ({
  handleRdpProxyConnection: vi.fn(),
}));

vi.mock('./state', () => ({
  clientStates: new Map(),
  registerUserSocket: vi.fn(),
  unregisterUserSocket: vi.fn(),
}));

vi.mock('./heartbeat', () => ({
  resetHeartbeat: vi.fn(),
  cleanupHeartbeat: vi.fn(),
}));

vi.mock('./utils', () => ({
  cleanupClientConnection: vi.fn(),
}));

class MockWebSocketServer extends EventEmitter {
  clients = new Set<WebSocket>();
}

function createMockWebSocket(
  overrides: Partial<AuthenticatedWebSocket> = {}
): AuthenticatedWebSocket {
  const ws = new EventEmitter() as AuthenticatedWebSocket;
  ws.readyState = WebSocket.OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.userId = 7;
  ws.username = 'tester';
  Object.assign(ws, overrides);
  return ws;
}

describe('WebSocket Connection Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应将 ssh:exec_silent 消息分发到 handleSshExecSilent 并透传 requestId', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket();
    const request = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      isRdpProxy: false,
      clientIpAddress: '127.0.0.1',
    } as any;

    wss.emit('connection', ws, request);
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'ssh:exec_silent',
          requestId: 'req-ssh-silent-1',
          payload: { command: 'pwd', timeoutMs: 5000 },
        })
      )
    );
    await Promise.resolve();

    expect(registerUserSocket).toHaveBeenCalledWith(7, ws);
    expect(handleSshExecSilent).toHaveBeenCalledWith(
      ws,
      { command: 'pwd', timeoutMs: 5000 },
      'req-ssh-silent-1'
    );
  });

  it('消息校验失败时应返回 error 且不分发到 handler', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket();
    const request = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      isRdpProxy: false,
      clientIpAddress: '127.0.0.1',
    } as any;

    wss.emit('connection', ws, request);
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'ssh:exec_silent', payload: {} })));
    await Promise.resolve();

    expect(handleSshExecSilent).not.toHaveBeenCalled();
    const rawMessage = (ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1][0];
    const parsedMessage = JSON.parse(rawMessage);
    expect(parsedMessage.type).toBe('error');
    expect(parsedMessage.payload).toContain(
      'payload.command 或 payload.commandsByShell 至少提供一个'
    );
  });
});
