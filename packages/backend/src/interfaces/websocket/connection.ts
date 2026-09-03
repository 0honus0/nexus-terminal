import WebSocket, { type RawData, type WebSocketServer } from 'ws';
import type { SshSuspendService } from '../../modules/ssh-suspend/ssh-suspend.service';
import type { WorkspaceSftpSessionService } from '../../modules/workspace/services/workspace-sftp-session.service';
import type { AuthenticatedWebSocket, WebSocketRequest } from './types';
import { handleRdpProxyConnection } from './handlers/rdp.handler';
import { handleSftpUploadChunk } from './handlers/upload.handler';
import { cleanupClientConnection } from './utils';
import { routeWorkspaceMessage } from './router';
import { registerSshSuspendNotifications } from './handlers/suspend.handler';
import { bindUploadBinaryTransport, parseBinaryUploadChunk } from './transports/upload-binary.transport';

function bindStandardWorkspaceConnection(
  ws: AuthenticatedWebSocket,
  request: WebSocketRequest,
  clientIp: string,
  sshSuspendService: SshSuspendService,
  workspaceSftpSessionService: WorkspaceSftpSessionService,
): void {
  ws.on('message', async (message: RawData, isBinary: boolean) => {
    // Application traffic is sufficient evidence that the peer and proxy path
    // are alive even if pong frames are delayed behind buffered upload data.
    ws.isAlive = true;

    if (isBinary) {
      try {
        await handleSftpUploadChunk(ws, parseBinaryUploadChunk(message));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`WebSocket：来自 ${ws.username} 的无效二进制消息: ${errorMessage}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { message: errorMessage } }));
        }
      }
      return;
    }

    let parsedMessage: unknown;
    try {
      parsedMessage = JSON.parse(message.toString());
    } catch {
      console.error(`WebSocket：来自 ${ws.username} 的无效 JSON 消息:`, message.toString());
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (非 JSON)' }));
      }
      return;
    }

    if (!parsedMessage || typeof parsedMessage !== 'object' || typeof (parsedMessage as { type?: unknown }).type !== 'string') {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (缺少 type)' }));
      }
      return;
    }

    await routeWorkspaceMessage(
      ws,
      request,
      parsedMessage as { type: string; payload?: any; requestId?: string },
      clientIp,
      { sshSuspendService, workspaceSftpSessionService },
    );
  });

  ws.on('close', (code, reason) => {
    console.log(
      `WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 已断开连接。代码: ${code}, 原因: ${reason.toString()}`,
    );
    void cleanupClientConnection(ws.sessionId);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 发生错误:`, error);
    void cleanupClientConnection(ws.sessionId);
  });
}

export function initializeConnectionHandler(
  wss: WebSocketServer,
  sshSuspendService: SshSuspendService,
  workspaceSftpSessionService: WorkspaceSftpSessionService,
): void {
  wss.on('connection', (ws: AuthenticatedWebSocket, request: WebSocketRequest) => {
    ws.isAlive = true;
    const clientIp = request.clientIpAddress || 'unknown';

    console.log(
      `WebSocket：客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}, RDP Proxy: ${request.isRdpProxy}) 已连接。`,
    );

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    if (request.isRdpProxy) {
      handleRdpProxyConnection(ws, request);
      return;
    }
    if (bindUploadBinaryTransport(ws, request)) return;

    bindStandardWorkspaceConnection(ws, request, clientIp, sshSuspendService, workspaceSftpSessionService);
  });

  registerSshSuspendNotifications(wss, sshSuspendService);
  console.log('WebSocket connection handler initialized, including SshSuspendService event listener.');
}
