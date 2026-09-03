import http from 'http';
import { WebSocketServer } from 'ws';
import { RequestHandler } from 'express';
import { initializeHeartbeat } from './heartbeat';
import { initializeUpgradeHandler } from './upgrade';
import { initializeConnectionHandler } from './connection';
import { workspaceSessionRegistry, workspaceSftpSessionService } from '../../bootstrap/container/application.container';
import { sshSuspendService } from '../../modules/ssh-suspend/ssh-suspend.service';
import { cleanupClientConnection } from './utils';

export {
  AuthenticatedWebSocket,
  DockerContainer,
  DockerStats,
  PortInfo,
  SshSuspendClientToServerMessages,
  SshSuspendServerToClientMessages,
  SuspendedSessionInfo,
} from './types'; // Re-export essential types

export const initializeWebSocket = async (
  server: http.Server,
  sessionParser: RequestHandler,
): Promise<WebSocketServer> => {
  // Environment variables are expected to be loaded by index.ts

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  // const db = await getDbInstance(); // db instance might not be directly needed here anymore if all DB interactions are in services/handlers

  // 1. Initialize Heartbeat
  const heartbeatTimer = initializeHeartbeat(wss); // Store timer to potentially clear it, though heartbeat.ts handles its own wss.on('close')

  // 2. Initialize Upgrade Handler (handles authentication and protocol upgrade)
  initializeUpgradeHandler(server, wss, sessionParser);

  // 3. Initialize Connection Handler (handles 'connection' event and message routing)
  initializeConnectionHandler(wss, sshSuspendService, workspaceSftpSessionService);

  // --- WebSocket 服务器关闭处理 ---
  wss.on('close', () => {
    console.log('WebSocket 服务器正在关闭，清理心跳定时器和所有活动会话...');
    clearInterval(heartbeatTimer); // Clear heartbeat started by this function

    workspaceSessionRegistry.forEach((_state, sessionId) => {
      cleanupClientConnection(sessionId);
    });
    console.log('所有活动会话已清理。');
  });

  console.log('WebSocket 服务器初始化完成。');
  return wss;
};
