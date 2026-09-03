import type { WorkspaceSession } from '../../modules/workspace/workspace-session';
import {
  workspaceArchiveService,
  workspaceSessionRegistry,
  workspaceSftpTransferService,
  workspaceSftpUploadService,
  statusMonitorService,
  workspaceSftpSessionService,
} from '../../bootstrap/container/application.container';
import { sshSuspendService } from '../../modules/ssh-suspend/ssh-suspend.service';
import { disposeTerminalTransport } from './terminal-binary-protocol';
import { executionSessionManager } from '../../platform/execution/execution-session-manager';

/**
 * 清理指定会话 ID 关联的所有资源
 * @param sessionId - 会话 ID
 */
export const cleanupClientConnection = async (sessionId: string | undefined): Promise<void> => {
  if (!sessionId) return;

  const state = workspaceSessionRegistry.get(sessionId);
  if (state) {
    console.log(
      `WebSocket: 清理会话 ${sessionId} (用户: ${state.ws.username}, DB 连接 ID: ${state.dbConnectionId})...`,
    );

    if (state.shellSetup) {
      clearTimeout(state.shellSetup.timeout);
      state.shellSetup = undefined;
    }
    if (state.shellHookPromptTimeout) {
      clearTimeout(state.shellHookPromptTimeout);
      state.shellHookPromptTimeout = undefined;
    }
    if (state.pendingDirectoryChange) {
      clearTimeout(state.pendingDirectoryChange.timeout);
      state.pendingDirectoryChange = undefined;
    }
    disposeTerminalTransport(state);
    if (state.uploadWs && state.uploadWs.readyState !== 3) {
      try {
        state.uploadWs.close(1000, 'Main session closed');
      } catch {
        /* ignore upload transport close error */
      }
    }
    state.uploadWs = undefined;
    // 1. 停止状态轮询 (如果存在)
    if (statusMonitorService) statusMonitorService.clearSession(sessionId);

    // 2. 先清理依赖执行通道/SFTP 的后台文件任务，再释放 SFTP channels。
    await workspaceArchiveService.cleanupSession(sessionId);
    workspaceSftpTransferService.cleanupSession(sessionId);
    await workspaceSftpUploadService.cleanupSession(sessionId);
    workspaceSftpSessionService.closeChannels(sessionId);

    // 恢复事务尚未提交时，连接归还挂起服务，保留日志以便重试。
    if (state.resumeSuspendSessionId && state.ws.userId !== undefined) {
      const rolledBack = await sshSuspendService.rollbackResumeSession(state.ws.userId, state.resumeSuspendSessionId);
      if (rolledBack) {
        state.isSuspendedByService = true;
        if (state.executionSession.isReady) executionSessionManager.detach(sessionId);
        state.sshShellStream = undefined;
        state.resumeSuspendSessionId = undefined;
      }
    }

    // 3. 处理 SSH 连接 (核心修改点)
    if (
      state.isMarkedForSuspend &&
      state.executionSession.isReady &&
      state.sshShellStream &&
      state.suspendLogPath &&
      state.ws.userId !== undefined
    ) {
      console.log(`WebSocket: 会话 ${sessionId} 已被标记为待挂起，尝试移交给 SshSuspendService...`);
      const channelToPass = state.sshShellStream;
      let sshClientToPass: import('ssh2').Client | undefined;
      try {
        sshClientToPass = executionSessionManager.detach(sessionId);
        const takeoverDetails = {
          userId: state.ws.userId,
          originalSessionId: sessionId, // sessionId 是原始活动会话的ID
          sshClient: sshClientToPass,
          channel: state.sshShellStream,
          connectionName: state.connectionName || '未知连接',
          connectionId: String(state.dbConnectionId),
          logIdentifier: state.suspendLogPath, // 这是基于 originalSessionId 的日志标识
          customSuspendName: undefined, // 如果需要，可以从 state 或其他地方获取
          shellPid: state.shellPid,
          shellKind: state.shellKind,
          shellIntegrationReady: state.shellIntegrationReady,
          shellAtPrompt: state.shellAtPrompt,
        };

        // ExecutionSession 已从运行时注册表分离，SSH 所有权转交挂起服务。
        state.sshShellStream = undefined; // 清除引用
        state.isSuspendedByService = true; // 标记为已被服务接管（即使是尝试接管）

        const newSuspendId = await sshSuspendService.takeOverMarkedSession({
          ...takeoverDetails,
          sshClient: sshClientToPass, // 传递分离出来的实例
          channel: channelToPass, // 传递分离出来的实例
        });

        if (newSuspendId) {
          console.log(
            `WebSocket: 会话 ${sessionId} 已成功移交给 SshSuspendService，新的挂起ID: ${newSuspendId}。SSH 连接将由服务管理。`,
          );
          // SSH 资源已移交，不需要在这里关闭它们
        } else {
          console.warn(
            `WebSocket: 会话 ${sessionId} 移交给 SshSuspendService 失败 (takeOverMarkedSession 返回 null)。可能 SSH 连接在标记后已断开。将执行常规清理。`,
          );
          // 移交失败，执行常规关闭
          channelToPass?.end();
          sshClientToPass.end();
          state.isSuspendedByService = false; // 重置标记，因为接管失败
        }
      } catch (error) {
        console.error(`WebSocket: 会话 ${sessionId} 移交给 SshSuspendService 时发生错误:`, error);
        try {
          channelToPass.end();
        } catch {
          /* ignore cleanup error */
        }
        try {
          sshClientToPass?.end();
        } catch {
          /* ignore cleanup error */
        }
        state.isSuspendedByService = false; // 重置标记
      }
    } else if (!state.isSuspendedByService && state.executionSession.isReady) {
      // 未标记挂起，也未被服务接管，执行常规关闭
      state.sshShellStream?.end();
      executionSessionManager.delete(sessionId, true);
      console.log(`WebSocket: 会话 ${sessionId} 的 SSH 连接已关闭 (未标记挂起，未被服务接管)。`);
    } else if (state.isSuspendedByService) {
      // 已被服务接管（例如通过旧的 startSuspend 流程，或成功移交后），不在此处关闭
      console.log(`WebSocket: 会话 ${sessionId} 的 SSH 连接已由挂起服务管理，跳过关闭。`);
    }

    // 4. 从状态 Map 中移除
    workspaceSessionRegistry.delete(sessionId);

    // 5. 清除 WebSocket 上的 sessionId 关联 (可选，因为 ws 可能已关闭)
    if (state.ws && state.ws.sessionId === sessionId) {
      delete state.ws.sessionId;
    }

    console.log(`WebSocket: 会话 ${sessionId} 已清理。`);
  } else {
    // console.warn(`[WebSocket Utils] cleanupClientConnection: No state found for session ID ${sessionId}.`);
  }
};
