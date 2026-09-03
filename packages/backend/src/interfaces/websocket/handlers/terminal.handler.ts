import type { AuthenticatedWebSocket } from '../types';
import type { WorkspaceSession } from '../../../modules/workspace/workspace-session';
import {
  clearPendingDirectoryChange,
  ensureShellProbe,
  ensureShellPromptHook,
  filterSshShellOutput,
  handleShellPrompt,
  readShellCurrentPath,
  resolveRemoteDirectory,
  sendSshRequestMessage,
} from '../../../modules/workspace/services/workspace-shell-integration.service';
import {
  workspaceSessionRegistry,
  statusMonitorService,
} from '../../../bootstrap/container/application.container';
import WebSocket from 'ws';
import { StringDecoder } from 'string_decoder';
import { flushTerminalOutput, queueTerminalOutput } from '../terminal-binary-protocol';

const MAX_SSH_INPUT_BYTES = 256 * 1024;
const MAX_QUEUED_SSH_INPUT_BYTES = 1024 * 1024;

export const forwardSshShellOutput = (state: WorkspaceSession, data: Buffer, stderr = false): void => {
  const decoderKey = stderr ? 'shellStderrDecoder' : 'shellOutputDecoder';
  const decoder = state[decoderKey] ?? new StringDecoder('utf8');
  state[decoderKey] = decoder;

  const decoded = decoder.write(data);
  const visibleOutput = stderr ? decoded : filterSshShellOutput(state, decoded);
  if (visibleOutput) {
    queueTerminalOutput(state, Buffer.from(visibleOutput, 'utf8'));
  }
};

export const flushSshShellOutput = (state: WorkspaceSession): void => {
  const stdoutTail = state.shellOutputDecoder?.end() ?? '';
  state.shellOutputDecoder = undefined;
  if (stdoutTail) {
    const visibleOutput = filterSshShellOutput(state, stdoutTail);
    if (visibleOutput) {
      queueTerminalOutput(state, Buffer.from(visibleOutput, 'utf8'));
    }
  }

  const stderrTail = state.shellStderrDecoder?.end() ?? '';
  state.shellStderrDecoder = undefined;
  if (stderrTail) {
    queueTerminalOutput(state, Buffer.from(stderrTail, 'utf8'));
  }
  flushTerminalOutput(state);
};

const sendSshInputAck = (state: WorkspaceSession, sequence: number | undefined, bytes: number): void => {
  if (sequence === undefined || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type: 'ssh:input:ack', payload: { sequence, bytes } }));
};

const drainSshInputQueue = (state: WorkspaceSession): void => {
  if (state.sshInputWaitingForDrain || !state.sshShellStream) return;
  const queue = state.sshInputQueue ?? [];
  state.sshInputQueue = queue;
  while (queue.length > 0 && state.sshShellStream) {
    const item = queue.shift()!;
    const accepted = state.sshShellStream.write(item.data);
    sendSshInputAck(state, item.sequence, item.bytes);
    if (!accepted) {
      state.sshInputWaitingForDrain = true;
      state.sshShellStream.once('drain', () => {
        state.sshInputWaitingForDrain = false;
        drainSshInputQueue(state);
      });
      return;
    }
  }
};

export function handleSshInput(ws: AuthenticatedWebSocket, payload: any): void {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;

  if (!state || !state.sshShellStream) {
    console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SSH 输入，但无活动 Shell。`);
    return;
  }
  const data = payload?.data;
  if (typeof data === 'string' && state.isShellReady) {
    // Check isShellReady
    const bytes = Buffer.byteLength(data, 'utf8');
    if (bytes > MAX_SSH_INPUT_BYTES) {
      console.warn(`WebSocket: 会话 ${sessionId} 的单次 SSH 输入超过 ${MAX_SSH_INPUT_BYTES} 字节，已拒绝。`);
      return;
    }
    const sequence = payload?.sequence;
    if (sequence !== undefined && (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff)) {
      console.warn(`WebSocket: 会话 ${sessionId} 的 SSH 输入序号无效。`);
      return;
    }
    const queuedBytes = (state.sshInputQueue ?? []).reduce((total, item) => total + item.bytes, 0);
    if (queuedBytes + bytes > MAX_QUEUED_SSH_INPUT_BYTES) {
      console.warn(`WebSocket: 会话 ${sessionId} 的 SSH 输入队列超过限制，关闭连接以防止内存耗尽。`);
      ws.close(1009, 'SSH input queue limit exceeded');
      return;
    }
    // Any user input may be a partial command or belong to a foreground program.
    // Wait for the next explicit prompt marker before injecting a queued cd.
    state.shellAtPrompt = false;
    (state.sshInputQueue ??= []).push({ data, sequence, bytes });
    drainSshInputQueue(state);
  } else if (!state.isShellReady) {
    console.warn(`WebSocket: 会话 ${sessionId} 收到 SSH 输入，但 Shell 尚未就绪。`);
  }
}

export async function handleSshExecSilent(ws: AuthenticatedWebSocket, payload: any, requestId?: string): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;
  const fail = (error: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ssh:exec_silent:error', requestId, payload: { error } }));
    }
  };

  if (!requestId || payload?.action !== 'pwd') {
    fail('无效的静默命令请求。');
    return;
  }
  if (!state?.executionSession.isReady || !state.sshShellStream || !state.isShellReady) {
    fail('SSH Shell 尚未就绪。');
    return;
  }

  try {
    await ensureShellProbe(state);
    // This runs on an independent SSH exec channel. Reading /proc/<shell>/cwd does
    // not write into the PTY, so cat/vim/sleep and other foreground jobs are untouched
    // after the one-time lazy shell PID probe has completed.
    const output = await readShellCurrentPath(state);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ssh:exec_silent:result', requestId, payload: { output } }));
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export async function handleSshChangeDirectory(
  ws: AuthenticatedWebSocket,
  payload: any,
  requestId?: string,
): Promise<void> {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;
  const fail = (error: string) => {
    if (requestId && state) sendSshRequestMessage(state, 'ssh:change_directory:error', requestId, { error });
  };

  if (!requestId || typeof payload?.path !== 'string' || !payload.path.startsWith('/')) {
    fail('无效的终端目录切换请求。');
    return;
  }
  // The path is ultimately typed into an interactive PTY. C0/C1 control
  // characters can be interpreted by the terminal driver before shell quoting
  // applies (for example CR submits a line and Ctrl-C sends SIGINT), so reject
  // those paths instead of risking partial or unintended terminal input.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(payload.path)) {
    fail('终端目录切换不支持包含控制字符的路径。');
    return;
  }
  if (!state?.sshShellStream || !state.isShellReady) {
    fail('SSH Shell 尚未就绪。');
    return;
  }

  let expectedPath: string;
  try {
    expectedPath = await resolveRemoteDirectory(state, payload.path);
  } catch {
    fail('目标目录不存在或无权访问。');
    return;
  }

  try {
    await ensureShellPromptHook(state);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  if ((state.shellKind !== 'bash' && state.shellKind !== 'zsh') || !state.shellIntegrationReady) {
    fail('当前 Shell 不支持安全目录队列；为避免影响前台程序，未发送 cd。');
    return;
  }

  if (state.pendingDirectoryChange) {
    const previous = state.pendingDirectoryChange;
    clearPendingDirectoryChange(state);
    sendSshRequestMessage(state, 'ssh:change_directory:error', previous.requestId, {
      error: '已被新的目录切换请求替代。',
    });
  }

  const timeout = setTimeout(
    () => {
      if (state.pendingDirectoryChange?.requestId !== requestId) return;
      clearPendingDirectoryChange(state);
      sendSshRequestMessage(state, 'ssh:change_directory:error', requestId, { error: '等待 Shell 返回提示符超时。' });
    },
    10 * 60 * 1000,
  );
  state.pendingDirectoryChange = {
    requestId,
    path: payload.path,
    expectedPath,
    executing: false,
    timeout,
  };
  sendSshRequestMessage(state, 'ssh:change_directory:queued', requestId, {
    path: payload.path,
    waitingForPrompt: !state.shellAtPrompt,
  });

  if (state.shellAtPrompt) {
    await handleShellPrompt(state);
  }
}

export function handleSshResize(ws: AuthenticatedWebSocket, payload: any): void {
  const sessionId = ws.sessionId;
  const state = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;

  if (!state || !state.executionSession.isReady) {
    // sshClient is enough, stream might not be ready for resize yet
    console.warn(`WebSocket: 收到来自 ${ws.username} 的调整大小请求，但无有效会话或 SSH 客户端。`);
    return;
  }

  const { cols, rows } = payload || {};
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 1000 || rows > 500) {
    console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效调整大小请求:`, payload);
    return;
  }

  if (state.isShellReady && state.sshShellStream) {
    if (state.terminalCols === cols && state.terminalRows === rows) return;
    state.sshShellStream.setWindow(rows, cols, 0, 0);
    state.terminalCols = cols;
    state.terminalRows = rows;
  } else {
    // Store intended size if shell not ready, apply when shell is ready.
    // This part is a bit more complex as it requires modifying the shell opening logic.
    // For now, we just log if shell is not ready.
    console.warn(
      `WebSocket: 会话 ${sessionId} 收到调整大小请求，但 Shell 尚未就绪或流不存在 (isShellReady: ${state.isShellReady})。尺寸将不会立即应用。`,
    );
    // A more robust solution would queue the resize or store it in WorkspaceSession to be applied later.
  }
}

export function handleStatusSubscribe(ws: AuthenticatedWebSocket): void {
  const sessionId = ws.sessionId;
  if (!sessionId || !workspaceSessionRegistry.has(sessionId)) return;
  void statusMonitorService
    .startStatusPolling(sessionId)
    .catch((error) => console.error(`[StatusMonitor ${sessionId}] 启动失败:`, error));
}

export function handleStatusUnsubscribe(ws: AuthenticatedWebSocket): void {
  if (ws.sessionId) statusMonitorService.stopStatusPolling(ws.sessionId);
}

// 恢复会话后等待前端状态面板显式订阅，避免无界面的后台采样。
export function handleSshResumeSuccess(_sessionId: string): void {}
