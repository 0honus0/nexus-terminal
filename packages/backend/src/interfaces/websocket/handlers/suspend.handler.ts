import WebSocket, { type WebSocketServer } from 'ws';
import { StringDecoder } from 'string_decoder';
import type {
  AuthenticatedWebSocket,
  SshSuspendListResponse,
  SshSuspendResumedNotification,
  SshSuspendTerminatedResponse,
  SshSuspendEntryRemovedResponse,
  SshSuspendAutoTerminatedNotification,
  SshMarkForSuspendRequest,
  SshMarkedForSuspendAck,
  SshUnmarkForSuspendRequest,
  SshUnmarkedForSuspendAck,
  SshSuspendResumeRequest,
  SshSuspendTerminateRequest,
  SshSuspendRemoveEntryRequest,
} from '../types';
import type { SshSuspendService } from '../../../modules/ssh-suspend/ssh-suspend.service';
import type { WorkspaceSftpSessionService } from '../../../modules/workspace/services/workspace-sftp-session.service';
import { cleanupClientConnection } from '../utils';
import type { WorkspaceSession } from '../../../modules/workspace/workspace-session';
import { workspaceSessionRegistry } from '../../../bootstrap/container/application.container';
import { temporaryLogStorageService } from '../../../modules/ssh-suspend/temporary-log-storage.service';
import { executionSessionManager } from '../../../platform/execution/execution-session-manager';
import { flushSshShellOutput, forwardSshShellOutput, handleSshResumeSuccess } from './terminal.handler';
import { filterSshShellOutput } from '../../../modules/workspace/services/workspace-shell-integration.service';
import {
  sendTerminalFrameAndWaitForAck,
  setTerminalOutputHold,
  TerminalFrameFlag,
  TerminalFrameType,
} from '../terminal-binary-protocol';

const sendCachedTerminalOutput = async (
  state: WorkspaceSession,
  stream: AsyncIterable<Buffer | string>,
): Promise<void> => {
  const decoder = new StringDecoder('utf8');
  let pendingPayload: Buffer | undefined;
  const enqueueVisible = async (visible: string): Promise<void> => {
    if (!visible) return;
    const payload = Buffer.from(visible, 'utf8');
    if (pendingPayload) {
      await sendTerminalFrameAndWaitForAck(state, TerminalFrameType.CachedOutput, pendingPayload);
    }
    pendingPayload = payload;
  };

  for await (const chunk of stream) {
    const decoded = decoder.write(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    await enqueueVisible(filterSshShellOutput(state, decoded));
  }
  const tail = decoder.end();
  if (tail) await enqueueVisible(filterSshShellOutput(state, tail));
  await sendTerminalFrameAndWaitForAck(
    state,
    TerminalFrameType.CachedOutput,
    pendingPayload ?? Buffer.alloc(0),
    TerminalFrameFlag.Final,
  );
};

export async function handleSshSuspendMessage(
  ws: AuthenticatedWebSocket,
  type: string,
  payload: any,
  clientIp: string,
  sshSuspendService: SshSuspendService,
  workspaceSftpSessionService: WorkspaceSftpSessionService,
): Promise<boolean> {
  switch (type) {
case 'SSH_SUSPEND_LIST_REQUEST': {
  if (!ws.userId) {
    console.error(`[SSH_SUSPEND_LIST_REQUEST] 用户 ID 未定义。`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'SSH_SUSPEND_LIST_RESPONSE', payload: { suspendSessions: [] } })); // 返回空列表或错误
    break;
  }
  try {
    const sessions = await sshSuspendService.listSuspendedSessions(ws.userId);
    const response: SshSuspendListResponse = {
      type: 'SSH_SUSPEND_LIST_RESPONSE',
      payload: { suspendSessions: sessions },
    };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
  } catch (error: any) {
    console.error(`[SSH_SUSPEND_LIST_REQUEST] 获取挂起列表失败:`, error);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'SSH_SUSPEND_LIST_RESPONSE', payload: { suspendSessions: [] } })); // 返回空列表或错误
  }
  break;
}
case 'SSH_SUSPEND_RESUME_REQUEST': {
  const resumePayload = payload as SshSuspendResumeRequest['payload'];
  const { suspendSessionId, newFrontendSessionId } = resumePayload;
  // console.log(`[WebSocket Handler][${type}] 接到请求。UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, Payload: ${JSON.stringify(resumePayload)}`);

  if (!ws.userId) {
    console.error(`[WebSocket Handler][${type}] 用户 ID 未定义。`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_SUSPEND_RESUMED_NOTIF',
          payload: { suspendSessionId, newFrontendSessionId, success: false, error: '用户认证失败' },
        }),
      );
    break;
  }
  try {
    const result = await sshSuspendService.prepareResumeSession(ws.userId, suspendSessionId);

    if (result) {
      // console.log(`[WebSocket Handler][${type}] 成功恢复会话。准备设置新的 WorkspaceSession (ID: ${newFrontendSessionId})。`);
      const resumedConnectionId = parseInt(result.originalConnectionId, 10);
      const newSessionState: WorkspaceSession = {
        ws, // 当前的 WebSocket 连接
        executionSession: executionSessionManager.create({
          id: newFrontendSessionId,
          connectionId: resumedConnectionId,
          ownerType: 'workspace',
          ownerId: String(ws.userId),
          client: result.sshClient,
        }),
        sshShellStream: result.channel,
        dbConnectionId: resumedConnectionId,
        connectionName: result.connectionName, // 从结果中恢复
        ipAddress: clientIp,
        isShellReady: true, // 假设恢复后 Shell 立即可用
        shellPid: result.shellPid,
        shellKind: result.shellKind,
        shellIntegrationReady: result.shellIntegrationReady,
        shellAtPrompt: result.shellAtPrompt,
        terminalOutputHold: true,
        resumeSuspendSessionId: suspendSessionId,
      };
      workspaceSessionRegistry.set(newFrontendSessionId, newSessionState);
      ws.sessionId = newFrontendSessionId; // 将当前 ws 与新会话关联
      setTerminalOutputHold(newSessionState, true);
      // console.log(`[WebSocket Handler][${type}] 新 WorkspaceSession (ID: ${newFrontendSessionId}) 已设置并关联到当前 WebSocket。`);

      // 重新设置事件监听器，将数据流导向新的前端会话
      result.channel.pause();
      result.channel.removeAllListeners('data'); // 清除 SshSuspendService 可能设置的监听器
      result.channel.on('data', (data: Buffer) => {
        forwardSshShellOutput(newSessionState, data);
      });
      let resumedSessionTerminated = false;
      const handleResumedSessionTermination = (reason: string) => {
        if (resumedSessionTerminated) return;
        resumedSessionTerminated = true;
        console.log(`[WebSocket Handler][${type}] 恢复的会话 ${newFrontendSessionId} 已终止: ${reason}`);
        flushSshShellOutput(newSessionState);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type: 'ssh:disconnected', payload: { sessionId: newFrontendSessionId } }),
          );
        }
        void cleanupClientConnection(newFrontendSessionId);
      };
      result.channel.on('close', () => handleResumedSessionTermination('channel closed'));
      result.channel.on('end', () => handleResumedSessionTermination('channel ended'));
      result.channel.on('error', (error: Error) =>
        handleResumedSessionTermination(`channel error: ${error.message}`),
      );
      result.sshClient.on('error', (err: Error) => {
        console.error(
          `[WebSocket Handler][${type}] 恢复后的 SSH 客户端错误 (会话: ${newFrontendSessionId}):`,
          err,
        );
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              type: 'ssh:error',
              payload: { sessionId: newFrontendSessionId, error: err.message },
            }),
          );
        handleResumedSessionTermination(`SSH client error: ${err.message}`);
      });
      result.sshClient.on('end', () => handleResumedSessionTermination('SSH client ended'));
      // console.log(`[WebSocket Handler][${type}] 已为恢复的会话 ${newFrontendSessionId} 设置事件监听器。`);

      // 流式读取并逐帧等待 xterm ACK；最终帧确认后才删除挂起日志。
      const logStream = await temporaryLogStorageService.createLogReadStream(result.logIdentifier);
      await sendCachedTerminalOutput(newSessionState, logStream);
      if (!(await sshSuspendService.commitResumeSession(ws.userId, suspendSessionId))) {
        throw new Error('挂起恢复事务提交失败。');
      }
      newSessionState.resumeSuspendSessionId = undefined;
      setTerminalOutputHold(newSessionState, false);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'ssh:connected',
            payload: {
              connectionId: newSessionState.dbConnectionId,
              sessionId: newFrontendSessionId,
            },
          }),
        );
      }
      void workspaceSftpSessionService.initialize(newFrontendSessionId).catch((sftpInitErr) => {
        console.error(
          `[WebSocket Handler][${type}] 为恢复的会话 ${newFrontendSessionId} 初始化 SFTP 失败:`,
          sftpInitErr,
        );
      });
      handleSshResumeSuccess(newFrontendSessionId);
      const responseNotification: SshSuspendResumedNotification = {
        type: 'SSH_SUSPEND_RESUMED_NOTIF',
        payload: { suspendSessionId, newFrontendSessionId, success: true },
      };
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(responseNotification));
    } else {
      throw new Error('服务未能恢复会话，或会话不存在/状态不正确。');
    }
  } catch (error: any) {
    // console.error(`[WebSocket Handler][${type}] 处理恢复会话 ${suspendSessionId} 时发生错误:`, error);
    await cleanupClientConnection(newFrontendSessionId);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_SUSPEND_RESUMED_NOTIF',
          payload: {
            suspendSessionId,
            newFrontendSessionId,
            success: false,
            error: error.message || '恢复会话失败',
          },
        }),
      );
  }
  break;
}
case 'SSH_SUSPEND_TERMINATE_REQUEST': {
  const { suspendSessionId } = payload as SshSuspendTerminateRequest['payload'];
  console.log(
    `[WebSocket Handler] Received SSH_SUSPEND_TERMINATE_REQUEST. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, SuspendSessionID: ${suspendSessionId}`,
  );
  if (!ws.userId) {
    console.error(`[SSH_SUSPEND_TERMINATE_REQUEST] 用户 ID 未定义。Payload: ${JSON.stringify(payload)}`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_SUSPEND_TERMINATED_RESP',
          payload: { suspendSessionId, success: false, error: '用户认证失败' },
        }),
      );
    break;
  }
  try {
    const success = await sshSuspendService.terminateSuspendedSession(ws.userId, suspendSessionId);
    const response: SshSuspendTerminatedResponse = {
      type: 'SSH_SUSPEND_TERMINATED',
      payload: { suspendSessionId, success },
    };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
  } catch (error: any) {
    console.error(`[SSH_SUSPEND_TERMINATE_REQUEST] 终止会话 ${suspendSessionId} 失败:`, error);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_SUSPEND_TERMINATED_RESP',
          payload: { suspendSessionId, success: false, error: error.message || '终止会话失败' },
        }),
      );
  }
  break;
}
case 'SSH_SUSPEND_REMOVE_ENTRY': {
  const { suspendSessionId } = payload as SshSuspendRemoveEntryRequest['payload'];
  console.log(
    `[WebSocket Handler] Received SSH_SUSPEND_REMOVE_ENTRY. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, SuspendSessionID: ${suspendSessionId}`,
  );
  if (!ws.userId) {
    console.error(`[SSH_SUSPEND_REMOVE_ENTRY] 用户 ID 未定义。Payload: ${JSON.stringify(payload)}`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_SUSPEND_ENTRY_REMOVED_RESP',
          payload: { suspendSessionId, success: false, error: '用户认证失败' },
        }),
      );
    break;
  }
  try {
    const success = await sshSuspendService.removeDisconnectedSessionEntry(ws.userId, suspendSessionId);
    const response: SshSuspendEntryRemovedResponse = {
      type: 'SSH_SUSPEND_ENTRY_REMOVED',
      payload: { suspendSessionId, success },
    };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
  } catch (error: any) {
    console.error(`[SSH_SUSPEND_REMOVE_ENTRY] 移除条目 ${suspendSessionId} 失败:`, error);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_SUSPEND_ENTRY_REMOVED_RESP',
          payload: { suspendSessionId, success: false, error: error.message || '移除条目失败' },
        }),
      );
  }
  break;
}
// SSH_SUSPEND_EDIT_NAME case removed, handled by HTTP API now
case 'SSH_MARK_FOR_SUSPEND': {
  const markPayload = payload as SshMarkForSuspendRequest['payload'];
  const sessionToMarkId = markPayload.sessionId;
  const initialBuffer = markPayload.initialBuffer; // +++ 获取 initialBuffer +++
  console.log(
    `[WebSocket Handler] Received SSH_MARK_FOR_SUSPEND. UserID: ${ws.userId}, TargetSessionID: ${sessionToMarkId}, InitialBuffer provided: ${!!initialBuffer}`,
  );

  if (!ws.userId) {
    console.error(`[SSH_MARK_FOR_SUSPEND] 用户 ID 未定义。`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
          payload: {
            sessionId: sessionToMarkId,
            success: false,
            error: '用户认证失败',
          } as SshMarkedForSuspendAck['payload'],
        }),
      );
    break;
  }

  const activeSessionState = workspaceSessionRegistry.get(sessionToMarkId);
  if (!activeSessionState || !activeSessionState.executionSession.isReady || !activeSessionState.sshShellStream) {
    console.error(`[SSH_MARK_FOR_SUSPEND] 找不到活动的SSH会话或其组件: ${sessionToMarkId}`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
          payload: {
            sessionId: sessionToMarkId,
            success: false,
            error: '未找到要标记的活动SSH会话',
          } as SshMarkedForSuspendAck['payload'],
        }),
      );
    break;
  }

  if (activeSessionState.isMarkedForSuspend) {
    console.warn(`[SSH_MARK_FOR_SUSPEND] 会话 ${sessionToMarkId} 已被标记。`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
          payload: {
            sessionId: sessionToMarkId,
            success: true,
            error: '会话已被标记',
          } as SshMarkedForSuspendAck['payload'],
        }),
      );
    break;
  }

  try {
    // 使用活动会话ID作为日志文件名的一部分
    const logPathSuffix = sessionToMarkId; // 使用原始 sessionId 作为日志文件名
    activeSessionState.isMarkedForSuspend = true;
    activeSessionState.suspendLogPath = logPathSuffix; // 存储日志标识符 (服务内部会拼接完整路径)

    // 确保日志目录存在 (服务内部通常会做，但这里也可以调用一次)
    await temporaryLogStorageService.ensureLogDirectoryExists();

    // +++ 如果有 initialBuffer，先写入它 +++
    if (initialBuffer) {
      // xterm 序列化快照包含颜色、样式和光标位置，必须原样保存。
      await temporaryLogStorageService.writeToLog(logPathSuffix, initialBuffer);
      console.log(`[SSH_MARK_FOR_SUSPEND] 已将初始缓冲区写入日志 (会话: ${sessionToMarkId})。`);
    }
    // --- 移除自动添加的日志标记行 ---
    // await temporaryLogStorageService.writeToLog(logPathSuffix, `--- Log recording continued for session ${sessionToMarkId} at ${new Date().toISOString()} ---\n`);

    console.log(
      `[SSH_MARK_FOR_SUSPEND] 会话 ${sessionToMarkId} 已成功标记待挂起。日志将记录到与 ${logPathSuffix} 关联的文件。`,
    );
    const response: SshMarkedForSuspendAck = {
      type: 'SSH_MARKED_FOR_SUSPEND_ACK',
      payload: { sessionId: sessionToMarkId, success: true },
    };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
  } catch (error: any) {
    console.error(`[SSH_MARK_FOR_SUSPEND] 标记会话 ${sessionToMarkId} 失败:`, error);
    if (activeSessionState) {
      // 如果状态存在，尝试回滚标记
      activeSessionState.isMarkedForSuspend = false;
      activeSessionState.suspendLogPath = undefined;
    }
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
          payload: {
            sessionId: sessionToMarkId,
            success: false,
            error: error.message || '标记会话失败',
          } as SshMarkedForSuspendAck['payload'],
        }),
      );
  }
  break;
}
case 'SSH_UNMARK_FOR_SUSPEND': {
  const unmarkPayload = payload as SshUnmarkForSuspendRequest['payload'];
  const sessionToUnmarkId = unmarkPayload.sessionId;
  console.log(
    `[WebSocket Handler] Received SSH_UNMARK_FOR_SUSPEND. UserID: ${ws.userId}, TargetSessionID: ${sessionToUnmarkId}`,
  );
  const ackPayloadBase = { sessionId: sessionToUnmarkId };

  if (!ws.userId) {
    console.error(`[SSH_UNMARK_FOR_SUSPEND] 用户 ID 未定义。`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
          payload: {
            ...ackPayloadBase,
            success: false,
            error: '用户认证失败',
          } as SshUnmarkedForSuspendAck['payload'],
        }),
      );
    break;
  }

  const activeSessionState = workspaceSessionRegistry.get(sessionToUnmarkId);
  if (!activeSessionState) {
    console.warn(`[SSH_UNMARK_FOR_SUSPEND] 未找到会话: ${sessionToUnmarkId}`);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
          payload: {
            ...ackPayloadBase,
            success: false,
            error: '未找到要取消标记的会话',
          } as SshUnmarkedForSuspendAck['payload'],
        }),
      );
    break;
  }

  if (!activeSessionState.isMarkedForSuspend) {
    console.warn(`[SSH_UNMARK_FOR_SUSPEND] 会话 ${sessionToUnmarkId} 并未被标记为待挂起。`);
    // 即使未标记，也回复成功，因为最终状态是“未标记”
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
          payload: {
            ...ackPayloadBase,
            success: true,
            error: '会话本就未标记',
          } as SshUnmarkedForSuspendAck['payload'],
        }),
      );
    break;
  }

  try {
    activeSessionState.isMarkedForSuspend = false;
    const logPathToDelete = activeSessionState.suspendLogPath;
    activeSessionState.suspendLogPath = undefined; // 清除日志路径

    if (logPathToDelete) {
      await temporaryLogStorageService.deleteLog(logPathToDelete);
      console.log(
        `[SSH_UNMARK_FOR_SUSPEND] 已删除会话 ${sessionToUnmarkId} 的临时挂起日志: ${logPathToDelete}`,
      );
    }

    console.log(`[SSH_UNMARK_FOR_SUSPEND] 会话 ${sessionToUnmarkId} 已成功取消标记。`);
    const response: SshUnmarkedForSuspendAck = {
      type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
      payload: { ...ackPayloadBase, success: true },
    };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
  } catch (error: any) {
    console.error(`[SSH_UNMARK_FOR_SUSPEND] 取消标记会话 ${sessionToUnmarkId} 失败:`, error);
    // 尝试回滚状态（尽管可能意义不大，因为错误可能在删除日志时发生）
    if (activeSessionState) {
      activeSessionState.isMarkedForSuspend = true; // 保持标记状态
      // activeSessionState.suspendLogPath = logPathToDelete; // 如果需要，可以恢复路径，但删除失败更可能是问题
    }
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
          payload: {
            ...ackPayloadBase,
            success: false,
            error: error.message || '取消标记会话失败',
          } as SshUnmarkedForSuspendAck['payload'],
        }),
      );
  }
  break;
}
    default:
      return false;
  }
  return true;
}

export function registerSshSuspendNotifications(
  wss: WebSocketServer,
  sshSuspendService: SshSuspendService,
): void {
  sshSuspendService.on(
    'sessionAutoTerminated',
    (eventPayload: { userId: number; suspendSessionId: string; reason: string }) => {
      const { userId, suspendSessionId, reason } = eventPayload;
      console.log(`[WebSocket 通知] 准备发送 SSH_SUSPEND_AUTO_TERMINATED_NOTIF 给用户 ${userId} 的会话 ${suspendSessionId}`);
      wss.clients.forEach((client) => {
        const wsClient = client as AuthenticatedWebSocket;
        if (wsClient.userId === userId && wsClient.readyState === WebSocket.OPEN) {
          const notification: SshSuspendAutoTerminatedNotification = {
            type: 'SSH_SUSPEND_AUTO_TERMINATED',
            payload: { suspendSessionId, reason },
          };
          wsClient.send(JSON.stringify(notification));
        }
      });
    },
  );
}
