import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { AuthenticatedWebSocket, ClientState } from '../types';
import {
  clientStates,
  sftpService,
  statusMonitorService,
  auditLogService,
  notificationService,
} from '../state';
import * as SshService from '../../services/ssh.service';
import { cleanupClientConnection } from '../utils';
import { temporaryLogStorageService } from '../../ssh-suspend/temporary-log-storage.service';
import { startDockerStatusPolling } from './docker.handler';
import { getErrorMessage } from '../../utils/AppError';

type SilentExecShellFlavor = 'posix' | 'powershell' | 'cmd' | 'fish';
type SilentExecSuccessCriteria = 'any' | 'non_empty' | 'absolute_path';

interface SilentExecPayload {
  command?: string;
  commandsByShell?: Record<string, unknown>;
  timeoutMs?: number;
  shellFlavorHint?: string;
  successCriteria?: string;
}

const MAX_SILENT_OUTPUT_SIZE = 64 * 1024;
const MAX_SILENT_LINE_BUFFER_SIZE = 16 * 1024;

interface PendingSilentExecRequest {
  ws: AuthenticatedWebSocket;
  sessionId: string;
  requestId: string;
  commandCandidates: string[];
  timeoutMs: number;
  successCriteria: SilentExecSuccessCriteria;
  attemptIndex: number;
  lastError?: string;
  startMarker: string;
  endMarker: string;
  pendingLineBuffer: string;
  isCollectingOutput: boolean;
  collectedOutput: string;
  timeoutId?: NodeJS.Timeout;
}

const pendingSilentExecRequests = new Map<string, PendingSilentExecRequest>();
const SILENT_PWD_PREFIX = '__NX_PWD__';
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const isAbsolutePath = (value: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(value);

const extractAbsolutePathFromSilentLine = (line: string): string | null => {
  const sanitizedLine = line.replace(ANSI_ESCAPE_PATTERN, '').trim();
  if (!sanitizedLine) {
    return null;
  }

  const pathCandidate = sanitizedLine.startsWith(SILENT_PWD_PREFIX)
    ? sanitizedLine.slice(SILENT_PWD_PREFIX.length).trim()
    : sanitizedLine;
  return isAbsolutePath(pathCandidate) ? pathCandidate : null;
};

const clearSilentExecTimer = (request: PendingSilentExecRequest): void => {
  if (request.timeoutId) {
    clearTimeout(request.timeoutId);
    request.timeoutId = undefined;
  }
};

const hasAbsolutePathInOutput = (output: string): boolean =>
  output
    .replace(/\r/g, '')
    .split('\n')
    .some((line) => Boolean(extractAbsolutePathFromSilentLine(line)));

const normalizeSilentExecSuccessCriteria = (value: unknown): SilentExecSuccessCriteria => {
  if (value === 'any' || value === 'non_empty' || value === 'absolute_path') {
    return value;
  }
  return 'non_empty';
};

const isSilentExecOutputAccepted = (
  criteria: SilentExecSuccessCriteria,
  output: string
): boolean => {
  if (criteria === 'any') {
    return true;
  }
  if (criteria === 'absolute_path') {
    return hasAbsolutePathInOutput(output);
  }
  return output.trim().length > 0;
};

const finalizeSilentExecWithError = (sessionId: string, error: string): void => {
  const request = pendingSilentExecRequests.get(sessionId);
  if (!request) {
    return;
  }
  clearSilentExecTimer(request);
  pendingSilentExecRequests.delete(sessionId);
  sendSilentExecResponse(request.ws, 'ssh:exec_silent:error', request.requestId, { error });
};

const finalizeSilentExecWithResult = (sessionId: string, output: string): void => {
  const request = pendingSilentExecRequests.get(sessionId);
  if (!request) {
    return;
  }
  clearSilentExecTimer(request);
  pendingSilentExecRequests.delete(sessionId);
  sendSilentExecResponse(request.ws, 'ssh:exec_silent:result', request.requestId, {
    output: output.replace(/\r/g, ''),
  });
};

const moveToNextSilentExecAttempt = (sessionId: string, reason: string): void => {
  const request = pendingSilentExecRequests.get(sessionId);
  if (!request) {
    return;
  }
  clearSilentExecTimer(request);
  request.attemptIndex += 1;
  request.lastError = reason;
  request.isCollectingOutput = false;
  request.collectedOutput = '';
};

const appendSilentCollectedOutput = (request: PendingSilentExecRequest, chunk: string): void => {
  if (!chunk || request.collectedOutput.length >= MAX_SILENT_OUTPUT_SIZE) {
    return;
  }
  request.collectedOutput += chunk;
  if (request.collectedOutput.length > MAX_SILENT_OUTPUT_SIZE) {
    request.collectedOutput = request.collectedOutput.slice(0, MAX_SILENT_OUTPUT_SIZE);
  }
};

const createSilentExecMarker = (requestId: string, attemptIndex: number): string => {
  const normalizedRequestId = requestId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const randomSuffix = uuidv4().replace(/-/g, '').slice(0, 10);
  return `${normalizedRequestId}_${attemptIndex}_${randomSuffix}`;
};

const startSilentExecAttempt = (sessionId: string): void => {
  const request = pendingSilentExecRequests.get(sessionId);
  if (!request) {
    return;
  }

  const command = request.commandCandidates[request.attemptIndex];
  if (!command) {
    finalizeSilentExecWithError(
      sessionId,
      request.lastError || 'Failed to execute silent command in current shell.'
    );
    return;
  }

  const state = clientStates.get(sessionId);
  if (!state?.sshShellStream || !state.isShellReady) {
    finalizeSilentExecWithError(sessionId, 'Shell channel is not ready.');
    return;
  }

  const marker = createSilentExecMarker(request.requestId, request.attemptIndex);
  request.startMarker = `__NX_SILENT_START_${marker}__`;
  request.endMarker = `__NX_SILENT_END_${marker}__`;
  request.isCollectingOutput = false;
  request.collectedOutput = '';

  request.timeoutId = setTimeout(() => {
    moveToNextSilentExecAttempt(sessionId, 'Timed out while waiting for command output.');
    startSilentExecAttempt(sessionId);
  }, request.timeoutMs);

  try {
    const wrappedCommand = `echo ${request.startMarker}\n${command}\necho ${request.endMarker}\n`;
    state.sshShellStream.write(wrappedCommand);
  } catch (error: unknown) {
    moveToNextSilentExecAttempt(
      sessionId,
      `Failed to write command to shell stream: ${getErrorMessage(error)}`
    );
    startSilentExecAttempt(sessionId);
  }
};

const processSshStreamOutput = (sessionId: string, chunk: string): string => {
  const request = pendingSilentExecRequests.get(sessionId);
  if (!request) {
    return chunk;
  }

  request.pendingLineBuffer += chunk.replace(/\r/g, '');
  const lines = request.pendingLineBuffer.split('\n');
  request.pendingLineBuffer = lines.pop() || '';
  let overflowOutput = '';

  // 仅对“最后一个未换行残片”做上限控制，避免大包时误伤 marker 所在完整行。
  if (request.pendingLineBuffer.length > MAX_SILENT_LINE_BUFFER_SIZE) {
    const overflowLength = request.pendingLineBuffer.length - MAX_SILENT_LINE_BUFFER_SIZE;
    const overflowChunk = request.pendingLineBuffer.slice(0, overflowLength);
    request.pendingLineBuffer = request.pendingLineBuffer.slice(overflowLength);

    if (request.isCollectingOutput) {
      appendSilentCollectedOutput(request, overflowChunk);
    } else {
      overflowOutput = overflowChunk;
    }
  }
  const visibleLines: string[] = [];

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    const hasStartMarker =
      trimmedLine === request.startMarker || rawLine.includes(request.startMarker);
    const isStartEchoLine = rawLine.includes(`echo ${request.startMarker}`);
    const hasEndMarker = trimmedLine === request.endMarker || rawLine.includes(request.endMarker);
    const isEndEchoLine = rawLine.includes(`echo ${request.endMarker}`);

    if (!request.isCollectingOutput) {
      if (hasStartMarker && !isStartEchoLine) {
        request.isCollectingOutput = true;
        request.collectedOutput = '';
        continue;
      }

      if (isStartEchoLine) {
        continue;
      }

      visibleLines.push(rawLine);
      continue;
    }

    if (hasEndMarker && !isEndEchoLine) {
      const normalizedOutput = request.collectedOutput.replace(/\r/g, '');
      const hasMoreCandidates = request.attemptIndex + 1 < request.commandCandidates.length;
      const isAccepted = isSilentExecOutputAccepted(request.successCriteria, normalizedOutput);

      clearSilentExecTimer(request);
      request.isCollectingOutput = false;
      request.collectedOutput = '';

      if (!isAccepted && hasMoreCandidates) {
        moveToNextSilentExecAttempt(
          sessionId,
          `Command output does not match success criteria: ${request.successCriteria}.`
        );
        startSilentExecAttempt(sessionId);
      } else {
        finalizeSilentExecWithResult(sessionId, normalizedOutput);
      }
      continue;
    }

    if (isEndEchoLine) {
      continue;
    }

    appendSilentCollectedOutput(
      request,
      request.collectedOutput.length > 0 ? `\n${rawLine}` : rawLine
    );
  }

  let visibleOutput = visibleLines.length > 0 ? `${visibleLines.join('\n')}\n` : '';
  if (overflowOutput) {
    visibleOutput += overflowOutput;
  }

  // 如果本次处理过程中请求已结束，补发尚未换行的尾部内容（常见于 shell prompt）。
  if (!pendingSilentExecRequests.has(sessionId) && request.pendingLineBuffer) {
    visibleOutput += request.pendingLineBuffer;
    request.pendingLineBuffer = '';
  }

  return visibleOutput;
};

const normalizeShellFlavor = (value: unknown): SilentExecShellFlavor | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'posix' ||
    normalized === 'powershell' ||
    normalized === 'cmd' ||
    normalized === 'fish'
  ) {
    return normalized;
  }
  return undefined;
};

const getSilentExecCommandCandidates = (payload: SilentExecPayload): string[] => {
  if (typeof payload.command === 'string' && payload.command.trim()) {
    return [payload.command.trim()];
  }

  if (!payload.commandsByShell || typeof payload.commandsByShell !== 'object') {
    return [];
  }

  const commandMap = payload.commandsByShell;
  const shellHint = normalizeShellFlavor(payload.shellFlavorHint);
  const candidateKeys: Array<SilentExecShellFlavor | 'default'> = shellHint
    ? [shellHint, 'default']
    : ['posix', 'default', 'fish', 'powershell', 'cmd'];
  const commands = new Set<string>();

  for (const key of candidateKeys) {
    const value = commandMap[key];
    if (typeof value === 'string' && value.trim()) {
      commands.add(value.trim());
    }
  }

  return Array.from(commands);
};

const getSilentExecTimeoutMs = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 5000;
  }
  return Math.max(1000, Math.min(Math.floor(value), 20000));
};

const sendSilentExecResponse = (
  ws: AuthenticatedWebSocket,
  type: 'ssh:exec_silent:result' | 'ssh:exec_silent:error',
  requestId: string,
  payload: Record<string, unknown>
): void => {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({ type, requestId, payload }));
};

export function handleSshExecSilent(
  ws: AuthenticatedWebSocket,
  rawPayload: unknown,
  requestIdFromMessage?: string
): void {
  const sessionId = ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  const requestId =
    typeof requestIdFromMessage === 'string' && requestIdFromMessage.trim()
      ? requestIdFromMessage
      : uuidv4();

  if (!sessionId || !state?.sshClient || !state.sshShellStream || !state.isShellReady) {
    sendSilentExecResponse(ws, 'ssh:exec_silent:error', requestId, {
      error: 'SSH shell is not ready.',
    });
    return;
  }

  const payload = (rawPayload || {}) as SilentExecPayload;
  const commandCandidates = getSilentExecCommandCandidates(payload);
  if (commandCandidates.length === 0) {
    sendSilentExecResponse(ws, 'ssh:exec_silent:error', requestId, {
      error: 'Missing command for silent execution.',
    });
    return;
  }

  if (pendingSilentExecRequests.has(sessionId)) {
    sendSilentExecResponse(ws, 'ssh:exec_silent:error', requestId, {
      error: 'Another silent command is already in progress.',
    });
    return;
  }

  const request: PendingSilentExecRequest = {
    ws,
    sessionId,
    requestId,
    commandCandidates,
    timeoutMs: getSilentExecTimeoutMs(payload.timeoutMs),
    successCriteria: normalizeSilentExecSuccessCriteria(payload.successCriteria),
    attemptIndex: 0,
    startMarker: '',
    endMarker: '',
    pendingLineBuffer: '',
    isCollectingOutput: false,
    collectedOutput: '',
  };

  pendingSilentExecRequests.set(sessionId, request);
  startSilentExecAttempt(sessionId);
}

export async function handleSshConnect(
  ws: AuthenticatedWebSocket,
  request: Request,
  payload: any
): Promise<void> {
  const { sessionId } = ws;
  const existingState = sessionId ? clientStates.get(sessionId) : undefined;

  if (sessionId && existingState) {
    console.warn(
      `WebSocket: 用户 ${ws.username} (会话: ${sessionId}) 已有活动连接，忽略新的连接请求。`
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:error', payload: '已存在活动的 SSH 连接。' }));
    return;
  }

  const dbConnectionId = payload?.connectionId;
  if (!dbConnectionId) {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:error', payload: '缺少 connectionId。' }));
    return;
  }

  console.log(`WebSocket: 用户 ${ws.username} 请求连接到数据库 ID: ${dbConnectionId}`);
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在处理连接请求...' }));

  const clientIp = (request as any).clientIpAddress || 'unknown';
  let connInfo: SshService.DecryptedConnectionDetails | null = null;

  try {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在获取连接信息...' }));
    connInfo = await SshService.getConnectionDetails(dbConnectionId);

    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:status', payload: `正在连接到 ${connInfo.host}...` }));
    const sshClient = await SshService.establishSshConnection(connInfo);

    // SSH 连接已建立，TCP_NODELAY 将通过连接配置自动应用

    const newSessionId = uuidv4();
    ws.sessionId = newSessionId; // Assign new sessionId to the WebSocket

    const dbConnectionIdAsNumber = parseInt(dbConnectionId, 10);
    if (Number.isNaN(dbConnectionIdAsNumber)) {
      console.error(
        `WebSocket: 无效的 dbConnectionId '${dbConnectionId}' (非数字)，无法创建会话 ${newSessionId}。`
      );
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'ssh:error', payload: '无效的连接 ID。' }));
      sshClient.end();
      ws.close(1008, 'Invalid Connection ID');
      return;
    }

    const newState: ClientState = {
      ws,
      sshClient,
      dbConnectionId: dbConnectionIdAsNumber,
      connectionName: connInfo!.name,
      connectedAt: Math.floor(Date.now() / 1000),
      ipAddress: clientIp,
      isShellReady: false,
    };
    clientStates.set(newSessionId, newState);
    console.log(
      `WebSocket: 为用户 ${ws.username} (IP: ${clientIp}) 创建新会话 ${newSessionId} (DB ID: ${dbConnectionIdAsNumber}, 连接名称: ${newState.connectionName})`
    );

    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:status', payload: 'SSH 连接成功，正在打开 Shell...' }));
    try {
      const defaultCols = payload?.cols || 80; // Use provided cols or default
      const defaultRows = payload?.rows || 24; // Use provided rows or default
      sshClient.shell(
        {
          term: payload?.term || 'xterm-256color',
          cols: defaultCols,
          rows: defaultRows,
        },
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
              ws.send(
                JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 失败: ${err.message}` })
              );
            }
            cleanupClientConnection(newSessionId);
            return;
          }

          console.log(
            `WebSocket: 会话 ${newSessionId} Shell 打开成功 (尺寸 ${defaultCols}x${defaultRows})。`
          );
          newState.sshShellStream = stream;
          newState.isShellReady = true;

          stream.on('data', (data: Buffer) => {
            const processedOutput = processSshStreamOutput(newSessionId, data.toString('utf8'));
            if (ws.readyState === WebSocket.OPEN) {
              if (processedOutput) {
                // 确保数据以 UTF-8 编码转换为 Base64
                ws.send(
                  JSON.stringify({
                    type: 'ssh:output',
                    payload: Buffer.from(processedOutput, 'utf8').toString('base64'),
                    encoding: 'base64',
                  })
                );
              }
            }
            // 如果会话被标记为待挂起，则将输出写入日志
            const currentState = clientStates.get(newSessionId); // 获取最新的状态
            if (
              processedOutput &&
              currentState?.isMarkedForSuspend &&
              currentState.suspendLogPath
            ) {
              temporaryLogStorageService
                .writeToLog(currentState.suspendLogPath, processedOutput)
                .catch((err) => {
                  console.error(
                    `[SSH Handler] 写入标记会话 ${newSessionId} 的日志失败 (路径: ${currentState.suspendLogPath}):`,
                    err
                  );
                });
            }
          });
          stream.stderr.on('data', (data: Buffer) => {
            const processedOutput = processSshStreamOutput(newSessionId, data.toString('utf8'));
            if (processedOutput) {
              console.error(
                `SSH Stderr (会话: ${newSessionId}): ${processedOutput.substring(0, 100)}...`
              );
            }
            if (ws.readyState === WebSocket.OPEN) {
              if (processedOutput) {
                // 确保数据以 UTF-8 编码转换为 Base64
                ws.send(
                  JSON.stringify({
                    type: 'ssh:output',
                    payload: Buffer.from(processedOutput, 'utf8').toString('base64'),
                    encoding: 'base64',
                  })
                );
              }
            }
            // 同样，如果会话被标记为待挂起，则将 stderr 输出写入日志
            const currentState = clientStates.get(newSessionId);
            if (
              processedOutput &&
              currentState?.isMarkedForSuspend &&
              currentState.suspendLogPath
            ) {
              temporaryLogStorageService
                .writeToLog(currentState.suspendLogPath, `[STDERR] ${processedOutput}`)
                .catch((err) => {
                  console.error(
                    `[SSH Handler] 写入标记会话 ${newSessionId} 的 STDERR 日志失败 (路径: ${currentState.suspendLogPath}):`,
                    err
                  );
                });
            }
          });
          stream.on('close', () => {
            finalizeSilentExecWithError(
              newSessionId,
              'Shell channel closed before silent command completed.'
            );
            console.log(`SSH: 会话 ${newSessionId} 的 Shell 通道已关闭。`);
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
              })
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
          sftpService
            .initializeSftpSession(newSessionId)
            .then(() => console.log(`SFTP: 会话 ${newSessionId} 异步初始化成功。`))
            .catch((sftpInitError) =>
              console.error(`WebSocket: 会话 ${newSessionId} 异步初始化 SFTP 失败:`, sftpInitError)
            );

          statusMonitorService.startStatusPolling(newSessionId);
          startDockerStatusPolling(newSessionId); // Start Docker polling
        }
      );
    } catch (shellError: unknown) {
      const shellErrMsg = getErrorMessage(shellError);
      console.error(`SSH: 会话 ${newSessionId} 打开 Shell 时发生意外错误: ${shellErrMsg}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'ssh:error',
            payload: `打开 Shell 时发生意外错误: ${shellErrMsg}`,
          })
        );
      }
      cleanupClientConnection(newSessionId);
    }

    sshClient.on('close', () => {
      finalizeSilentExecWithError(
        newSessionId,
        'SSH connection closed before silent command completed.'
      );
      console.log(`SSH: 会话 ${newSessionId} 的客户端连接已关闭。`);
      cleanupClientConnection(newSessionId);
    });
    sshClient.on('error', (err: Error) => {
      finalizeSilentExecWithError(
        newSessionId,
        `SSH client error before silent command completed: ${err.message}`
      );
      console.error(`SSH: 会话 ${newSessionId} 的客户端连接错误:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ssh:error', payload: `SSH 连接错误: ${err.message}` }));
      }
      cleanupClientConnection(newSessionId);
    });
  } catch (connectError: unknown) {
    const connectErrMsg = getErrorMessage(connectError);
    console.error(
      `WebSocket: 用户 ${ws.username} (IP: ${clientIp}) 连接到数据库 ID ${dbConnectionId} 失败:`,
      connectError
    );
    auditLogService.logAction('SSH_CONNECT_FAILURE', {
      userId: ws.userId,
      username: ws.username,
      connectionId: dbConnectionId,
      connectionName: connInfo?.name || 'Unknown',
      ip: clientIp,
      reason: connectErrMsg,
    });
    notificationService.sendNotification('SSH_CONNECT_FAILURE', {
      userId: ws.userId,
      username: ws.username,
      connectionId: dbConnectionId,
      ip: clientIp,
      reason: connectErrMsg,
    });
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'ssh:error', payload: `连接失败: ${connectErrMsg}` }));
    ws.close(1011, `SSH Connection Failed: ${connectErrMsg}`);
  }
}

export function handleSshInput(ws: AuthenticatedWebSocket, payload: any): void {
  const { sessionId } = ws;
  const state = sessionId ? clientStates.get(sessionId) : undefined;

  if (!state || !state.sshShellStream) {
    console.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SSH 输入，但无活动 Shell。`
    );
    return;
  }
  // 注意：Schema 已校验 payload 为 string 类型
  const data = typeof payload === 'string' ? payload : payload?.data;
  if (typeof data === 'string' && state.isShellReady) {
    // Check isShellReady
    state.sshShellStream.write(data);
  } else if (!state.isShellReady) {
    console.warn(`WebSocket: 会话 ${sessionId} 收到 SSH 输入，但 Shell 尚未就绪。`);
  }
}

export function handleSshResize(ws: AuthenticatedWebSocket, payload: any): void {
  const { sessionId } = ws;
  const state = sessionId ? clientStates.get(sessionId) : undefined;

  if (!state || !state.sshClient) {
    // sshClient is enough, stream might not be ready for resize yet
    console.warn(`WebSocket: 收到来自 ${ws.username} 的调整大小请求，但无有效会话或 SSH 客户端。`);
    return;
  }

  const { cols, rows } = payload || {};
  if (typeof cols !== 'number' || typeof rows !== 'number' || cols <= 0 || rows <= 0) {
    console.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效调整大小请求:`,
      payload
    );
    return;
  }

  if (state.isShellReady && state.sshShellStream) {
    console.log(`SSH: 会话 ${sessionId} 调整终端大小: ${cols}x${rows}`);
    state.sshShellStream.setWindow(rows, cols, 0, 0);
  } else {
    // Store intended size if shell not ready, apply when shell is ready.
    // This part is a bit more complex as it requires modifying the shell opening logic.
    // For now, we just log if shell is not ready.
    console.warn(
      `WebSocket: 会话 ${sessionId} 收到调整大小请求，但 Shell 尚未就绪或流不存在 (isShellReady: ${state.isShellReady})。尺寸将不会立即应用。`
    );
    // A more robust solution would queue the resize or store it in ClientState to be applied later.
  }
}

// 处理会话恢复后的状态监控启动
export function handleSshResumeSuccess(sessionId: string): void {
  const state = clientStates.get(sessionId);
  if (state && state.sshClient) {
    statusMonitorService.startStatusPolling(sessionId);
    // 如果 Docker 状态也需要恢复，可以在这里添加
    // startDockerStatusPolling(sessionId);
  } else {
    console.error(
      `[SSH Handler ${sessionId}] 无法为恢复的会话启动状态轮询：未找到会话状态或 SSH 客户端。`
    );
  }
}
