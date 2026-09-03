import WebSocket, { WebSocketServer, RawData } from 'ws';
import { StringDecoder } from 'string_decoder';
import {
  AuthenticatedWebSocket,
  WebSocketRequest,
  SshSuspendListRequest,
  SshSuspendResumeRequest,
  SshSuspendTerminateRequest,
  SshSuspendRemoveEntryRequest,
  // SshSuspendEditNameRequest, // Removed as it's now HTTP
  SshSuspendListResponse,
  SshSuspendResumedNotification,
  SshSuspendTerminatedResponse,
  SshSuspendEntryRemovedResponse,
  // SshSuspendNameEditedResponse, // Removed as it's now HTTP
  SshSuspendAutoTerminatedNotification,
  SshMarkForSuspendRequest,
  SshMarkedForSuspendAck,
  SshUnmarkForSuspendRequest,
  SshUnmarkedForSuspendAck,
} from './types';
import { SshSuspendService } from '../ssh-suspend/ssh-suspend.service';
import { WorkspaceSftpSessionService } from '../sftp/workspace-sftp-session.service';
import { cleanupClientConnection } from './utils';
import type { WorkspaceSession } from '../workspace/workspace-session';
import { workspaceSessionRegistry } from '../runtime/service-container';
import { temporaryLogStorageService } from '../ssh-suspend/temporary-log-storage.service';
import { executionSessionManager } from '../execution/execution-session-manager';

// Handlers
import { handleRdpProxyConnection } from './handlers/rdp.handler';
import {
  handleSshConnect,
  handleSshInput,
  handleSshExecSilent,
  handleSshChangeDirectory,
  filterSshShellOutput,
  flushSshShellOutput,
  forwardSshShellOutput,
  handleSshResize,
  handleSshResumeSuccess,
  handleStatusSubscribe,
  handleStatusUnsubscribe,
} from './handlers/ssh.handler';
import { handleDockerGetStatus, handleDockerCommand, handleDockerGetStats } from './handlers/docker.handler';
import {
  handleSftpOperation,
  handleSftpUploadPrepare,
  handleSftpUploadStart,
  handleSftpUploadChunk,
  handleSftpUploadCancel,
  handleSftpUploadCancelAll,
} from './handlers/sftp.handler';
import {
  acknowledgeTerminalOutput,
  sendTerminalFrameAndWaitForAck,
  setTerminalOutputHold,
  TerminalFrameFlag,
  TerminalFrameType,
} from './terminal-binary-protocol';

const UPLOAD_FRAME_MAGIC = Buffer.from('NXUP', 'ascii');
const UPLOAD_FRAME_VERSION = 1;
const UPLOAD_FRAME_FIXED_HEADER_SIZE = 12;
const MAX_UPLOAD_ID_BYTES = 512;
const MAX_UPLOAD_CHUNK_BYTES = 1024 * 1024;

const rawDataToBuffer = (message: RawData): Buffer => {
  if (Buffer.isBuffer(message)) return message;
  if (Array.isArray(message)) return Buffer.concat(message);
  return Buffer.from(message);
};

const parseBinaryUploadChunk = (message: RawData) => {
  const frame = rawDataToBuffer(message);
  if (frame.length < UPLOAD_FRAME_FIXED_HEADER_SIZE) {
    throw new Error('二进制上传帧过短');
  }
  if (!frame.subarray(0, 4).equals(UPLOAD_FRAME_MAGIC)) {
    throw new Error('未知的二进制消息类型');
  }
  if (frame.readUInt8(4) !== UPLOAD_FRAME_VERSION) {
    throw new Error(`不支持的上传协议版本: ${frame.readUInt8(4)}`);
  }

  const flags = frame.readUInt8(5);
  if ((flags & ~1) !== 0) throw new Error('上传帧包含未知标志');
  const uploadIdLength = frame.readUInt16BE(6);
  const chunkIndex = frame.readUInt32BE(8);
  if (uploadIdLength === 0 || uploadIdLength > MAX_UPLOAD_ID_BYTES) {
    throw new Error('上传任务 ID 长度无效');
  }
  const payloadOffset = UPLOAD_FRAME_FIXED_HEADER_SIZE + uploadIdLength;
  if (payloadOffset > frame.length) throw new Error('上传帧头长度越界');

  const uploadId = frame.toString('utf8', UPLOAD_FRAME_FIXED_HEADER_SIZE, payloadOffset);
  if (!uploadId) throw new Error('上传任务 ID 为空');
  const data = frame.subarray(payloadOffset);
  if (data.length > MAX_UPLOAD_CHUNK_BYTES) {
    throw new Error(`上传分块超过限制: ${data.length}/${MAX_UPLOAD_CHUNK_BYTES} 字节`);
  }
  return {
    uploadId,
    chunkIndex,
    isLast: (flags & 1) === 1,
    data,
  };
};

const sendCachedTerminalOutput = async (state: WorkspaceSession, stream: AsyncIterable<Buffer | string>): Promise<void> => {
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

export function initializeConnectionHandler(
  wss: WebSocketServer,
  sshSuspendService: SshSuspendService,
  workspaceSftpSessionService: WorkspaceSftpSessionService,
): void {
  wss.on('connection', (ws: AuthenticatedWebSocket, request: WebSocketRequest) => {
    ws.isAlive = true;
    const isRdpProxy = request.isRdpProxy;
    const clientIp = request.clientIpAddress || 'unknown'; // Preserved from upgrade handler

    console.log(
      `WebSocket：客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}, RDP Proxy: ${isRdpProxy}) 已连接。`,
    );

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    if (isRdpProxy) {
      handleRdpProxyConnection(ws, request);
    } else if (request.isUploadTransport) {
      const uploadSessionId = request.uploadSessionId;
      const state = uploadSessionId ? workspaceSessionRegistry.get(uploadSessionId) : undefined;
      if (!uploadSessionId || !state || state.ws.userId !== ws.userId) {
        console.warn(
          `WebSocket: 拒绝上传数据通道绑定，用户 ${ws.username} 无权访问会话 ${uploadSessionId || '(missing)'}。`,
        );
        ws.close(1008, 'Invalid upload session');
        return;
      }

      ws.sessionId = uploadSessionId;
      if (state.uploadWs && state.uploadWs !== ws && state.uploadWs.readyState === WebSocket.OPEN) {
        state.uploadWs.close(1000, 'Upload transport replaced');
      }
      state.uploadWs = ws;
      console.log(`WebSocket: 会话 ${uploadSessionId} 的独立上传数据通道已连接。`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'sftp:upload:transport:ready', payload: { sessionId: uploadSessionId } }));
      }

      ws.on('message', async (message: RawData, isBinary: boolean) => {
        ws.isAlive = true;
        if (!isBinary) {
          console.warn(`WebSocket: 上传数据通道 ${uploadSessionId} 收到非二进制消息，已拒绝。`);
          ws.close(1003, 'Upload transport accepts binary frames only');
          return;
        }
        try {
          await handleSftpUploadChunk(ws, parseBinaryUploadChunk(message));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`WebSocket: 上传数据通道 ${uploadSessionId} 的二进制消息无效: ${errorMessage}`);
          if (state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { message: errorMessage } }));
          }
          ws.close(1003, 'Invalid upload frame');
        }
      });

      const detachUploadTransport = () => {
        const currentState = workspaceSessionRegistry.get(uploadSessionId);
        if (currentState?.uploadWs === ws) currentState.uploadWs = undefined;
      };
      ws.on('close', (code, reason) => {
        detachUploadTransport();
        console.log(
          `WebSocket: 会话 ${uploadSessionId} 的上传数据通道已断开。代码: ${code}, 原因: ${reason.toString()}`,
        );
      });
      ws.on('error', (error) => {
        detachUploadTransport();
        console.error(`WebSocket: 会话 ${uploadSessionId} 的上传数据通道发生错误:`, error);
      });
    } else {
      // Standard SSH/SFTP/Docker connection
      ws.on('message', async (message: RawData, isBinary: boolean) => {
        // Any successfully received application frame proves that the peer and
        // proxy path are alive. During uploads, pong frames can sit behind queued
        // binary data on a slow uplink, so relying on pong alone can terminate an
        // actively transferring connection.
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

        let parsedMessage: any;
        try {
          parsedMessage = JSON.parse(message.toString());
        } catch (e) {
          console.error(`WebSocket：来自 ${ws.username} 的无效 JSON 消息:`, message.toString());
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (非 JSON)' }));
          return;
        }

        const { type, payload, requestId } = parsedMessage;
        const sessionId = ws.sessionId; // Get current WebSocket's session ID

        // It's crucial to get the state associated with the current ws.sessionId
        // For 'ssh:connect', ws.sessionId will be undefined initially, so state will be undefined.
        // For other messages, ws.sessionId should exist if connection was successful.
        const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;

        try {
          switch (type) {
            // SSH Cases
            case 'ssh:connect':
              // Pass the original Express request object for IP and session
              await handleSshConnect(ws, request, payload);
              break;
            case 'ssh:input':
              handleSshInput(ws, payload);
              break;
            case 'ssh:output:ack': {
              const sequence = payload?.sequence;
              if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
                throw new Error('无效的终端输出 ACK');
              }
              // ACK is emitted by the frontend only after xterm has consumed a binary
              // terminal frame. When the remote SSH side exits (for example `reboot`),
              // the shell-close path can dispose/delete the WorkspaceSession before those
              // already-delivered frames finish rendering. Such ACKs are expected and
              // must not be promoted to a generic protocol error on the still-open WS.
              if (!state) {
                console.debug(
                  `[WebSocket ${sessionId ?? 'detached'}] 忽略已结束会话的迟到终端输出 ACK: ${sequence}`,
                );
                break;
              }
              if (!acknowledgeTerminalOutput(state, sequence)) {
                console.warn(`[WebSocket ${sessionId}] 忽略未知或重复的终端输出 ACK: ${sequence}`);
              }
              break;
            }
            case 'ssh:exec_silent':
              await handleSshExecSilent(ws, payload, requestId);
              break;
            case 'ssh:change_directory':
              await handleSshChangeDirectory(ws, payload, requestId);
              break;
            case 'ssh:resize':
              handleSshResize(ws, payload);
              break;
            case 'status:subscribe':
              handleStatusSubscribe(ws);
              break;
            case 'status:unsubscribe':
              handleStatusUnsubscribe(ws);
              break;

            // Docker Cases
            case 'docker:get_status':
              await handleDockerGetStatus(ws, sessionId);
              break;
            case 'docker:command':
              await handleDockerCommand(ws, sessionId, payload);
              break;
            case 'docker:get_stats':
              await handleDockerGetStats(ws, sessionId, payload);
              break;

            // SFTP Cases (generic operations)
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
              break;

            // SFTP Upload Cases
            case 'sftp:upload:prepare':
              await handleSftpUploadPrepare(ws, payload);
              break;
            case 'sftp:upload:start':
              await handleSftpUploadStart(ws, payload);
              break;
            case 'sftp:upload:cancel':
              await handleSftpUploadCancel(ws, payload);
              break;
            case 'sftp:upload:cancel-all':
              await handleSftpUploadCancelAll(ws, payload);
              break;

            // --- SSH Suspend Cases ---

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
              console.warn(`WebSocket：收到来自 ${ws.username} (会话: ${sessionId}) 的未知消息类型: ${type}`);
              if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'error', payload: `不支持的消息类型: ${type}` }));
          }
        } catch (error: any) {
          console.error(
            `WebSocket: 处理来自 ${ws.username} (会话: ${sessionId}) 的消息 (${type}) 时发生顶层错误:`,
            error,
          );
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'error', payload: `处理消息时发生内部错误: ${error.message}` }));
        }
      });

      ws.on('close', (code, reason) => {
        console.log(
          `WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 已断开连接。代码: ${code}, 原因: ${reason.toString()}`,
        );
        cleanupClientConnection(ws.sessionId);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 发生错误:`, error);
        cleanupClientConnection(ws.sessionId); // Ensure cleanup on error too
      });
    }
  });

  // 监听 SshSuspendService 发出的会话自动终止事件
  sshSuspendService.on(
    'sessionAutoTerminated',
    (eventPayload: { userId: number; suspendSessionId: string; reason: string }) => {
      const { userId, suspendSessionId, reason } = eventPayload;
      console.log(
        `[WebSocket 通知] 准备发送 SSH_SUSPEND_AUTO_TERMINATED_NOTIF 给用户 ${userId} 的会话 ${suspendSessionId}`,
      );

      wss.clients.forEach((client) => {
        const wsClient = client as AuthenticatedWebSocket; // 类型断言
        if (wsClient.userId === userId && wsClient.readyState === WebSocket.OPEN) {
          const notification: SshSuspendAutoTerminatedNotification = {
            type: 'SSH_SUSPEND_AUTO_TERMINATED',
            payload: {
              suspendSessionId,
              reason,
            },
          };
          wsClient.send(JSON.stringify(notification));
          console.log(
            `[WebSocket 通知] 已发送 SSH_SUSPEND_AUTO_TERMINATED_NOTIF 给用户 ${userId} 的一个 WebSocket 连接 (会话 ${suspendSessionId})。`,
          );
        }
      });
    },
  );

  console.log('WebSocket connection handler initialized, including SshSuspendService event listener.');
}
