import { openWebSocket } from '@/client/websocket';
import type { TerminalChannel, TerminalOutput, TerminalViewport } from '@/features/terminal/public';

export interface AgentWorkspaceTerminalChannel extends TerminalChannel {
  close(): void;
}

const MAX_PENDING_BYTES = 256 * 1024;
const MAX_RECONNECT_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 3_000;

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
  let viewport: TerminalViewport = { columns: 80, rows: 24 };

  const emitError = (message: string): void => {
    for (const handler of errorHandlers) handler(message);
  };
  const emitClose = (reason?: string): void => {
    for (const handler of closeHandlers) handler(reason);
  };
  const control = (value: unknown): void => {
    if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };
  const flush = (): void => {
    if (!ready || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'resize', columns: viewport.columns, rows: viewport.rows }));
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
    const query = new URLSearchParams({
      appId: input.appId,
      workspaceId: input.workspaceId,
      generation: String(input.generation),
      columns: String(viewport.columns),
      rows: String(viewport.rows),
      ...(sessionId ? { sessionId } : {}),
    });
    const next = openWebSocket(`/ws/agent-terminal?${query.toString()}`);
    next.binaryType = 'arraybuffer';
    socket = next;

    next.addEventListener('message', (event) => {
      if (socket !== next || closed) return;
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data) as { type?: unknown; sessionId?: unknown };
          if (message.type !== 'ready' || typeof message.sessionId !== 'string' || !message.sessionId) return;
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
    resize: (nextViewport: TerminalViewport) => {
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
        current.send(JSON.stringify({ type: 'close' }));
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
