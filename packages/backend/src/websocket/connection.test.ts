import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { initializeConnectionHandler } from './connection';
import { AuthenticatedWebSocket } from './types';
import { handleSshExecSilent } from './handlers/ssh.handler';
import { registerUserSocket, clientStates } from './state';

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

vi.mock('../ssh-suspend/temporary-log-storage.service', () => ({
  temporaryLogStorageService: {
    ensureLogDirectoryExists: vi.fn().mockResolvedValue(undefined),
    writeToLog: vi.fn().mockResolvedValue(undefined),
    deleteLog: vi.fn().mockResolvedValue(undefined),
  },
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
    (clientStates as Map<string, any>).clear();
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

  it('SSH_MARK_FOR_SUSPEND 在请求 SID 过期时应优先使用当前 ws.sessionId', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket({ sessionId: 'sid-active-1' });
    (clientStates as Map<string, any>).set('sid-active-1', {
      sshClient: {},
      sshShellStream: {},
      isMarkedForSuspend: false,
    });
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
          type: 'SSH_MARK_FOR_SUSPEND',
          payload: { sessionId: 'sid-stale-1' },
        })
      )
    );
    await Promise.resolve();

    const rawMessage = (ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1][0];
    const parsedMessage = JSON.parse(rawMessage);
    expect(parsedMessage.type).toBe('SSH_MARKED_FOR_SUSPEND_ACK');
    expect(parsedMessage.payload.success).toBe(true);
    expect(parsedMessage.payload.sessionId).toBe('sid-active-1');
    expect((clientStates as Map<string, any>).get('sid-active-1')?.isMarkedForSuspend).toBe(true);
  });

  it('SSH_UNMARK_FOR_SUSPEND 在请求 SID 过期时应优先使用当前 ws.sessionId', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket({ sessionId: 'sid-active-2' });
    (clientStates as Map<string, any>).set('sid-active-2', {
      sshClient: {},
      sshShellStream: {},
      isMarkedForSuspend: true,
      suspendLogPath: undefined,
    });
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
          type: 'SSH_UNMARK_FOR_SUSPEND',
          payload: { sessionId: 'sid-stale-2' },
        })
      )
    );
    await Promise.resolve();

    const rawMessage = (ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1][0];
    const parsedMessage = JSON.parse(rawMessage);
    expect(parsedMessage.type).toBe('SSH_UNMARKED_FOR_SUSPEND_ACK');
    expect(parsedMessage.payload.success).toBe(true);
    expect(parsedMessage.payload.sessionId).toBe('sid-active-2');
    expect((clientStates as Map<string, any>).get('sid-active-2')?.isMarkedForSuspend).toBe(false);
  });
});
