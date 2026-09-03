import WebSocket from 'ws';
import type { SshSuspendService } from '../../modules/ssh-suspend/ssh-suspend.service';
import type { WorkspaceSftpSessionService } from '../../modules/workspace/services/workspace-sftp-session.service';
import { workspaceSessionRegistry } from '../../bootstrap/container/application.container';
import type { AuthenticatedWebSocket, WebSocketRequest } from './types';
import {
  handleSshInput,
  handleSshExecSilent,
  handleSshChangeDirectory,
  handleSshResize,
  handleStatusSubscribe,
  handleStatusUnsubscribe,
} from './handlers/terminal.handler';
import { handleSshConnect } from './handlers/workspace-session.handler';
import { handleDockerGetStatus, handleDockerCommand, handleDockerGetStats } from './handlers/docker.handler';
import { handleSftpOperation } from './handlers/filesystem.handler';
import {
  handleSftpUploadPrepare,
  handleSftpUploadStart,
  handleSftpUploadCancel,
  handleSftpUploadCancelAll,
} from './handlers/upload.handler';
import { acknowledgeTerminalOutput } from './terminal-binary-protocol';
import { handleSshSuspendMessage } from './handlers/suspend.handler';

export interface WorkspaceMessageRouterDependencies {
  sshSuspendService: SshSuspendService;
  workspaceSftpSessionService: WorkspaceSftpSessionService;
}

export interface WorkspaceProtocolMessage {
  type: string;
  payload?: any;
  requestId?: string;
}

export async function routeWorkspaceMessage(
  ws: AuthenticatedWebSocket,
  request: WebSocketRequest,
  message: WorkspaceProtocolMessage,
  clientIp: string,
  dependencies: WorkspaceMessageRouterDependencies,
): Promise<void> {
  const { type, payload, requestId } = message;
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;

  try {
    if (
      await handleSshSuspendMessage(
        ws,
        type,
        payload,
        clientIp,
        dependencies.sshSuspendService,
        dependencies.workspaceSftpSessionService,
      )
    ) {
      return;
    }

    switch (type) {
      case 'ssh:connect':
        await handleSshConnect(ws, request, payload);
        return;
      case 'ssh:input':
        handleSshInput(ws, payload);
        return;
      case 'ssh:output:ack': {
        const sequence = payload?.sequence;
        if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
          throw new Error('无效的终端输出 ACK');
        }
        if (!state) {
          console.debug(`[WebSocket ${sessionId ?? 'detached'}] 忽略已结束会话的迟到终端输出 ACK: ${sequence}`);
          return;
        }
        if (!acknowledgeTerminalOutput(state, sequence)) {
          console.warn(`[WebSocket ${sessionId}] 忽略未知或重复的终端输出 ACK: ${sequence}`);
        }
        return;
      }
      case 'ssh:exec_silent':
        await handleSshExecSilent(ws, payload, requestId);
        return;
      case 'ssh:change_directory':
        await handleSshChangeDirectory(ws, payload, requestId);
        return;
      case 'ssh:resize':
        handleSshResize(ws, payload);
        return;
      case 'status:subscribe':
        handleStatusSubscribe(ws);
        return;
      case 'status:unsubscribe':
        handleStatusUnsubscribe(ws);
        return;

      case 'docker:get_status':
        await handleDockerGetStatus(ws, sessionId);
        return;
      case 'docker:command':
        await handleDockerCommand(ws, sessionId, payload);
        return;
      case 'docker:get_stats':
        await handleDockerGetStats(ws, sessionId, payload);
        return;

      case 'sftp:readdir':
      case 'sftp:search':
      case 'sftp:stat':
      case 'sftp:readfile':
      case 'sftp:writefile':
      case 'sftp:mkdir':
      case 'sftp:rmdir':
      case 'sftp:unlink':
      case 'sftp:rename':
      case 'sftp:chmod':
      case 'sftp:realpath':
      case 'sftp:copy':
      case 'sftp:cross_copy':
      case 'sftp:delete_paths':
      case 'sftp:move':
      case 'sftp:transfer:cancel':
      case 'sftp:compress':
      case 'sftp:archive:cancel':
      case 'sftp:decompress':
        await handleSftpOperation(ws, type, payload, requestId);
        return;

      case 'sftp:upload:prepare':
        await handleSftpUploadPrepare(ws, payload);
        return;
      case 'sftp:upload:start':
        await handleSftpUploadStart(ws, payload);
        return;
      case 'sftp:upload:cancel':
        await handleSftpUploadCancel(ws, payload);
        return;
      case 'sftp:upload:cancel-all':
        await handleSftpUploadCancelAll(ws, payload);
        return;
      default:
        console.warn(`WebSocket：收到来自 ${ws.username} (会话: ${sessionId}) 的未知消息类型: ${type}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', payload: `不支持的消息类型: ${type}` }));
        }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`WebSocket: 处理来自 ${ws.username} (会话: ${sessionId}) 的消息 (${type}) 时发生顶层错误:`, error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', payload: `处理消息时发生内部错误: ${errorMessage}` }));
    }
  }
}
