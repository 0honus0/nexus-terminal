import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import type { AuthenticatedWebSocket, WebSocketRequest } from '../types';
import type { WorkspaceSession } from '../../../modules/workspace/workspace-session';
import {
  workspaceSessionRegistry,
  workspaceSftpSessionService,
  auditLogService,
  notificationService,
} from '../../../bootstrap/container/application.container';
import { sshCredentialResolver } from '../../../infrastructure/ssh/connection/ssh-credential-resolver';
import type { ResolvedSshConnection } from '../../../infrastructure/ssh/connection/ssh-connection.types';
import { cleanupClientConnection } from '../utils';
import { temporaryLogStorageService } from '../../../modules/ssh-suspend/temporary-log-storage.service';
import { executionSessionManager } from '../../../platform/execution/execution-session-manager';
import { flushSshShellOutput, forwardSshShellOutput } from './terminal.handler';

export async function handleSshConnect(
  ws: AuthenticatedWebSocket,
  request: WebSocketRequest,
  payload: any,
): Promise<void> {
  const connectStartedAt = Date.now();
  const sessionId = ws.sessionId;
  const existingState = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;

  if (sessionId && existingState) {
    console.warn(`WebSocket: 用户 ${ws.username} (会话: ${sessionId}) 已有活动连接，忽略新的连接请求。`);
    // A duplicate connect request is a no-op, not a transport failure. Sending
    // ssh:error here caused the frontend to mark the still-live SSH/SFTP
    // session as failed and grey out FileManager actions.
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'info', payload: '已存在活动的 SSH 连接，已忽略重复连接请求。' }));
    return;
  }

  const rawConnectionId = payload?.connectionId;
  const dbConnectionIdAsNumber = Number(rawConnectionId);
  if (!Number.isInteger(dbConnectionIdAsNumber) || dbConnectionIdAsNumber <= 0) {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:error', payload: '无效或缺少 connectionId。' }));
    return;
  }

  console.log(`WebSocket: 用户 ${ws.username} 请求连接到数据库 ID: ${dbConnectionIdAsNumber}`);
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在处理连接请求...' }));

  const clientIp = request.clientIpAddress || 'unknown';
  let connInfo: ResolvedSshConnection | null = null;

  try {
    const requestedSessionId = typeof payload?.clientSessionId === 'string' ? payload.clientSessionId.trim() : '';
    const canReuseClientSessionId =
      /^[A-Za-z0-9_-]{8,128}$/.test(requestedSessionId) &&
      !workspaceSessionRegistry.has(requestedSessionId) &&
      !executionSessionManager.get(requestedSessionId);
    const newSessionId = canReuseClientSessionId ? requestedSessionId : uuidv4();
    if (requestedSessionId && !canReuseClientSessionId) {
      console.warn(`WebSocket: 客户端会话 ID 无效或冲突，已回退到服务端 UUID。`);
    }

    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在获取连接信息...' }));
    connInfo = await sshCredentialResolver.resolveStored(dbConnectionIdAsNumber);
    const connectionDetailsReadyAt = Date.now();

    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:status', payload: `正在连接到 ${connInfo.host}...` }));
    const executionSession = await executionSessionManager.connect({
      id: newSessionId,
      connection: connInfo,
      ownerType: 'workspace',
      ownerId: ws.userId !== undefined ? String(ws.userId) : undefined,
    });
    const sshClient = executionSession.client;
    const sshTransportReadyAt = Date.now();
    ws.sessionId = newSessionId;

    const newState: WorkspaceSession = {
      ws,
      executionSession,
      dbConnectionId: dbConnectionIdAsNumber,
      connectionName: connInfo.name,
      ipAddress: clientIp,
      isShellReady: false,
      terminalCols: payload?.cols || 80,
      terminalRows: payload?.rows || 24,
    };
    workspaceSessionRegistry.set(newSessionId, newState);
    console.log(
      `WebSocket: 为用户 ${ws.username} (IP: ${clientIp}) 创建新会话 ${newSessionId} (DB ID: ${dbConnectionIdAsNumber}, 连接名称: ${newState.connectionName})`,
    );

    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:status', payload: 'SSH 连接成功，正在打开 Shell...' }));
    try {
      const defaultCols = payload?.cols || 80; // Use provided cols or default
      const defaultRows = payload?.rows || 24; // Use provided rows or default
      sshClient.shell(
        { term: payload?.term || 'xterm-256color', cols: defaultCols, rows: defaultRows },
        (err, stream) => {
          if (err) {
            console.error(`SSH: 会话 ${newSessionId} 打开 Shell 失败:`, err);
            auditLogService.logAction('SSH_SHELL_FAILURE', {
              connectionName: newState.connectionName,
              userId: ws.userId,
              username: ws.username,
              connectionId: dbConnectionIdAsNumber,
              sessionId: newSessionId,
              ip: newState.ipAddress,
              reason: err.message,
            });
            notificationService.sendNotification('SSH_SHELL_FAILURE', {
              userId: ws.userId,
              username: ws.username,
              connectionId: dbConnectionIdAsNumber,
              sessionId: newSessionId,
              ip: newState.ipAddress,
              reason: err.message,
            });
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 失败: ${err.message}` }));
            }
            cleanupClientConnection(newSessionId);
            return;
          }

          console.log(`WebSocket: 会话 ${newSessionId} Shell 打开成功 (尺寸 ${defaultCols}x${defaultRows})。`);
          newState.sshShellStream = stream;
          newState.isShellReady = true;

          // Shell path integration is intentionally lazy. Do not inject probe
          // commands during login; start it only when the file manager asks to
          // read the terminal cwd or to synchronize the terminal directory.

          stream.on('data', (data: Buffer) => {
            forwardSshShellOutput(newState, data);
            // 如果会话被标记为待挂起，则将输出写入日志
            const currentState = workspaceSessionRegistry.get(newSessionId); // 获取最新的状态
            if (currentState?.isMarkedForSuspend && currentState.suspendLogPath) {
              temporaryLogStorageService.writeToLog(currentState.suspendLogPath, data).catch((err) => {
                console.error(
                  `[SSH Handler] 写入标记会话 ${newSessionId} 的日志失败 (路径: ${currentState.suspendLogPath}):`,
                  err,
                );
              });
            }
          });
          stream.stderr.on('data', (data: Buffer) => {
            forwardSshShellOutput(newState, data, true);
            // 同样，如果会话被标记为待挂起，则将 stderr 输出写入日志
            const currentState = workspaceSessionRegistry.get(newSessionId);
            if (currentState?.isMarkedForSuspend && currentState.suspendLogPath) {
              temporaryLogStorageService
                .writeToLog(currentState.suspendLogPath, Buffer.concat([Buffer.from('[STDERR] ', 'utf8'), data]))
                .catch((err) => {
                  console.error(
                    `[SSH Handler] 写入标记会话 ${newSessionId} 的 STDERR 日志失败 (路径: ${currentState.suspendLogPath}):`,
                    err,
                  );
                });
            }
          });
          stream.on('close', () => {
            console.log(`SSH: 会话 ${newSessionId} 的 Shell 通道已关闭。`);
            flushSshShellOutput(newState);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ssh:disconnected', payload: 'Shell 通道已关闭。' }));
            }
            cleanupClientConnection(newSessionId);
          });

          if (ws.readyState === WebSocket.OPEN)
            ws.send(
              JSON.stringify({
                type: 'ssh:connected',
                payload: {
                  connectionId: dbConnectionIdAsNumber,
                  sessionId: newSessionId,
                },
              }),
            );
          const shellReadyAt = Date.now();
          console.log(
            `[SSH Timing ${newSessionId}] 配置 ${connectionDetailsReadyAt - connectStartedAt}ms, ` +
              `SSH握手 ${sshTransportReadyAt - connectionDetailsReadyAt}ms, ` +
              `Shell ${shellReadyAt - sshTransportReadyAt}ms, 总计 ${shellReadyAt - connectStartedAt}ms`,
          );
          console.log(`WebSocket: 会话 ${newSessionId} SSH 连接和 Shell 建立成功。`);
          auditLogService.logAction('SSH_CONNECT_SUCCESS', {
            userId: ws.userId,
            username: ws.username,
            connectionId: dbConnectionIdAsNumber,
            sessionId: newSessionId,
            ip: newState.ipAddress,
            connectionName: connInfo!.name,
          });
          notificationService.sendNotification('SSH_CONNECT_SUCCESS', {
            userId: ws.userId,
            username: ws.username,
            connectionId: dbConnectionIdAsNumber,
            sessionId: newSessionId,
            ip: newState.ipAddress,
          });

          console.log(`WebSocket: 会话 ${newSessionId} 正在异步初始化 SFTP...`);
          workspaceSftpSessionService
            .initialize(newSessionId)
            .then(() => console.log(`SFTP: 会话 ${newSessionId} 异步初始化成功。`))
            .catch((sftpInitError) =>
              console.error(`WebSocket: 会话 ${newSessionId} 异步初始化 SFTP 失败:`, sftpInitError),
            );
        },
      );
    } catch (shellError: any) {
      console.error(`SSH: 会话 ${newSessionId} 打开 Shell 时发生意外错误:`, shellError);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 时发生意外错误: ${shellError.message}` }));
      }
      cleanupClientConnection(newSessionId);
    }

    sshClient.on('close', () => {
      console.log(`SSH: 会话 ${newSessionId} 的客户端连接已关闭。`);
      cleanupClientConnection(newSessionId);
    });
    sshClient.on('error', (err: Error) => {
      console.error(`SSH: 会话 ${newSessionId} 的客户端连接错误:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ssh:error', payload: `SSH 连接错误: ${err.message}` }));
      }
      cleanupClientConnection(newSessionId);
    });
  } catch (connectError: any) {
    console.error(
      `WebSocket: 用户 ${ws.username} (IP: ${clientIp}) 连接到数据库 ID ${dbConnectionIdAsNumber} 失败:`,
      connectError,
    );
    auditLogService.logAction('SSH_CONNECT_FAILURE', {
      userId: ws.userId,
      username: ws.username,
      connectionId: dbConnectionIdAsNumber,
      connectionName: connInfo?.name || 'Unknown',
      ip: clientIp,
      reason: connectError.message,
    });
    notificationService.sendNotification('SSH_CONNECT_FAILURE', {
      userId: ws.userId,
      username: ws.username,
      connectionId: dbConnectionIdAsNumber,
      ip: clientIp,
      reason: connectError.message,
    });
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:error', payload: `连接失败: ${connectError.message}` }));
    ws.close(1011, `SSH Connection Failed: ${connectError.message}`);
  }
}
