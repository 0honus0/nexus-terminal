import type {
  AgentTerminalAttachQueryDto,
  AgentTerminalClientControlMessageDto,
  AgentTerminalReadyMessageDto,
} from '@nexus-terminal/protocol/agent-terminal';
import { openWebSocket } from '@/client/websocket';
import type { TerminalChannel, TerminalOutput, WorkspaceTerminalViewportDto } from '@/features/terminal/public';

export interface AgentWorkspaceTerminalChannel extends TerminalChannel {
  close(): void;
}

const MAX_PENDING_BYTES = 256 * 1024;
const MAX_RECONNECT_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 3_000;

const parseReadyMessage = (value: unknown): AgentTerminalReadyMessageDto | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== 'ready' ||
    !Number.isSafeInteger(message.generation) ||
    Number(message.generation) < 1 ||
    typeof message.sessionId !== 'string' ||
    !message.sessionId
  ) {
    return null;
  }
  return { type: 'ready', generation: Number(message.generation), sessionId: message.sessionId };
};

export const createAgentWorkspaceTerminalChannel = (input: {
  appId: string;
  workspaceId: string;
  generation: number;
}): AgentWorkspaceTerminalChannel => {
  const outputHandlers = new Set<(output: TerminalOutput) => void>();
  const closeHandlers = new Set<(reason?: string) => void>();
  const errorHandlers = new Set<(message: string) => void>();
  const pendingInput: string[] = [];
  let pendingBytes = 0;
  let socket: WebSocket | null = null;
  let sessionId: string | null = null;
  let ready = false;
  let closed = false;
  let reconnectTimer: number | null = null;
  let reconnectStartedAt = 0;
  let reconnectAttempt = 0;
  let viewport: WorkspaceTerminalViewportDto = { columns: 80, rows: 24 };

  const emitError = (message: string): void => {
    for (const handler of errorHandlers) handler(message);
  };
  const emitClose = (reason?: string): void => {
    for (const handler of closeHandlers) handler(reason);
  };
  const control = (value: AgentTerminalClientControlMessageDto): void => {
    if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };
  const flush = (): void => {
    if (!ready || socket?.readyState !== WebSocket.OPEN) return;
    const resizeMessage: AgentTerminalClientControlMessageDto = {
      type: 'resize',
      columns: viewport.columns,
      rows: viewport.rows,
    };
    socket.send(JSON.stringify(resizeMessage));
    for (const data of pendingInput.splice(0)) socket.send(new TextEncoder().encode(data));
    pendingBytes = 0;
  };
  const finish = (reason?: string, error?: string): void => {
    if (closed) return;
    closed = true;
    ready = false;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (error) emitError(error);
    emitClose(reason);
  };

  const connect = (): void => {
    if (closed) return;
    const attach: AgentTerminalAttachQueryDto = {
      appId: input.appId,
      workspaceId: input.workspaceId,
      generation: input.generation,
      columns: viewport.columns,
      rows: viewport.rows,
      ...(sessionId ? { sessionId } : {}),
    };
    const query = new URLSearchParams({
      appId: attach.appId,
      workspaceId: attach.workspaceId,
      generation: String(attach.generation),
      columns: String(attach.columns),
      rows: String(attach.rows),
      ...(attach.sessionId ? { sessionId: attach.sessionId } : {}),
    });
    const next = openWebSocket(`/ws/agent-terminal?${query.toString()}`);
    next.binaryType = 'arraybuffer';
    socket = next;

    next.addEventListener('message', (event) => {
      if (socket !== next || closed) return;
      if (typeof event.data === 'string') {
        try {
          const message = parseReadyMessage(JSON.parse(event.data) as unknown);
          if (!message || message.generation !== input.generation) {
            finish('WORKSPACE_TERMINAL_PROTOCOL_INVALID', 'WORKSPACE_TERMINAL_PROTOCOL_INVALID');
            next.close(1008, 'Workspace terminal protocol invalid');
            return;
          }
          if (sessionId && sessionId !== message.sessionId) {
            finish('WORKSPACE_TERMINAL_SESSION_CHANGED', 'WORKSPACE_TERMINAL_PROTOCOL_INVALID');
            next.close(1008, 'Workspace terminal session changed');
            return;
          }
          sessionId = message.sessionId;
          ready = true;
          reconnectAttempt = 0;
          reconnectStartedAt = 0;
          flush();
        } catch {
          emitError('WORKSPACE_TERMINAL_PROTOCOL_INVALID');
        }
        return;
      }
      const bytes = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array();
      if (bytes.byteLength === 0) return;
      for (const handler of outputHandlers) handler({ data: bytes });
    });
    next.addEventListener('close', (event) => {
      if (socket !== next || closed) return;
      socket = null;
      ready = false;
      if (event.code === 1000 || event.code === 1008) {
        finish(event.reason || undefined, event.code === 1008 ? 'WORKSPACE_TERMINAL_ATTACH_FAILED' : undefined);
        return;
      }
      const now = Date.now();
      if (!reconnectStartedAt) reconnectStartedAt = now;
      if (now - reconnectStartedAt >= MAX_RECONNECT_MS) {
        finish(event.reason || `WORKSPACE_TERMINAL_CLOSED_${event.code}`, 'WORKSPACE_TERMINAL_RECONNECT_EXHAUSTED');
        return;
      }
      const delay = Math.min(250 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    });
  };

  connect();

  return {
    sendInput: (data: string) => {
      if (closed) return;
      if (ready && socket?.readyState === WebSocket.OPEN) {
        socket.send(new TextEncoder().encode(data));
        return;
      }
      const bytes = new TextEncoder().encode(data).byteLength;
      if (pendingBytes + bytes > MAX_PENDING_BYTES) {
        emitError('WORKSPACE_TERMINAL_INPUT_QUEUE_FULL');
        return;
      }
      pendingInput.push(data);
      pendingBytes += bytes;
    },
    resize: (nextViewport: WorkspaceTerminalViewportDto) => {
      viewport = { ...nextViewport };
      control({ type: 'resize', columns: viewport.columns, rows: viewport.rows });
    },
    onOutput: (handler) => {
      outputHandlers.add(handler);
      return () => outputHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    onError: (handler) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    close: () => {
      if (closed) return;
      closed = true;
      ready = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      pendingInput.length = 0;
      pendingBytes = 0;
      const current = socket;
      socket = null;
      if (current?.readyState === WebSocket.OPEN) {
        const closeMessage: AgentTerminalClientControlMessageDto = { type: 'close' };
        current.send(JSON.stringify(closeMessage));
        current.close(1000, 'Workspace terminal closed by client');
      } else if (current?.readyState === WebSocket.CONNECTING) {
        current.close();
      }
      outputHandlers.clear();
      closeHandlers.clear();
      errorHandlers.clear();
    },
  };
};
