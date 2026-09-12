import WebSocket, { type RawData } from 'ws';
import type { AgentWorkspaceRuntimeFacade } from '../../modules/agent/public';
import type { WorkspaceRuntimeTerminalAttachment } from '../../modules/agent/workspace-runtime/workspace-runtime-interactive-session.port';
import { logger } from '../../shared/logging/logger';

const MAX_CONTROL_BYTES = 16 * 1024;
const MAX_INPUT_BYTES = 256 * 1024;
const HIGH_WATER_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const BACKPRESSURE_POLL_MS = 10;

interface AgentTerminalContext {
  userId: number;
  appId: string;
  workspaceId: string;
  generation: number;
  columns: number;
  rows: number;
  sessionId?: string;
}

const buffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, unknown>;
};

const validViewport = (columns: number, rows: number): boolean =>
  Number.isSafeInteger(columns) &&
  Number.isSafeInteger(rows) &&
  columns >= 2 &&
  rows >= 1 &&
  columns <= 1000 &&
  rows <= 500;

/** Browser-facing terminal protocol. Binary frames are terminal bytes; text frames are bounded control messages only. */
export class AgentTerminalProtocolSession {
  private session: WorkspaceRuntimeTerminalAttachment | null = null;
  private closed = false;
  private paused = false;
  private backpressureTimer: NodeJS.Timeout | undefined;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly socket: WebSocket,
    private readonly context: AgentTerminalContext,
    private readonly workspaceRuntime: AgentWorkspaceRuntimeFacade,
  ) {}

  async start(): Promise<void> {
    if (this.closed) return;
    const session = await this.workspaceRuntime.openTerminal(
      { userId: this.context.userId, appId: this.context.appId },
      this.context.workspaceId,
      this.context.generation,
      this.context.columns,
      this.context.rows,
      this.context.sessionId,
    );
    if (this.closed) {
      session.detach();
      return;
    }
    this.session = session;
    this.unsubscribers = [
      session.onData((data) => this.forward(data)),
      session.onStderr((data) => this.forward(data)),
      session.onClose(() => {
        if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, 'Workspace terminal closed');
      }),
      session.onError((error) => {
        logger.warn(
          { err: error, workspaceId: this.context.workspaceId, generation: this.context.generation },
          'Agent Workspace terminal session failed',
        );
        if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1011, 'Workspace terminal failed');
      }),
    ];
    if (!session.isOpen) {
      this.cleanupTransport();
      this.session = null;
      throw new Error('WORKSPACE_TERMINAL_SESSION_CLOSED');
    }
    session.replayBuffered();
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({ type: 'ready', generation: this.context.generation, sessionId: session.sessionId }),
      );
    }
  }

  handleMessage(data: RawData, isBinary: boolean): void {
    if (this.closed) return;
    const session = this.session;
    if (!session?.isOpen) {
      this.socket.close(1013, 'Workspace terminal is not ready');
      return;
    }
    if (isBinary) {
      const bytes = buffer(data);
      if (bytes.byteLength > MAX_INPUT_BYTES) {
        this.socket.close(1009, 'Workspace terminal input too large');
        return;
      }
      if (!session.write(bytes)) this.socket.close(1013, 'Workspace terminal input backpressure');
      return;
    }
    const bytes = buffer(data);
    if (bytes.byteLength > MAX_CONTROL_BYTES) {
      this.socket.close(1009, 'Workspace terminal control message too large');
      return;
    }
    try {
      const input = record(JSON.parse(bytes.toString('utf8')));
      if (input.type === 'resize') {
        const columns = Number(input.columns);
        const rows = Number(input.rows);
        if (!validViewport(columns, rows)) throw new Error('VALIDATION_FAILED');
        session.resize(columns, rows);
      } else if (input.type === 'signal') {
        if (typeof input.signal !== 'string' || input.signal.length > 16) throw new Error('VALIDATION_FAILED');
        session.signal(input.signal);
      } else if (input.type === 'close') {
        if (Object.keys(input).some((key) => key !== 'type')) throw new Error('VALIDATION_FAILED');
        void this.terminate();
      } else {
        throw new Error('VALIDATION_FAILED');
      }
    } catch {
      this.socket.close(1008, 'Workspace terminal control message invalid');
    }
  }

  /** A transport close only detaches. The managed PTY remains attachable during the grace window. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cleanupTransport();
    const session = this.session;
    this.session = null;
    session?.detach();
  }

  private async terminate(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cleanupTransport();
    const session = this.session;
    this.session = null;
    await session?.close().catch(() => undefined);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, 'Workspace terminal closed');
  }

  private cleanupTransport(): void {
    if (this.backpressureTimer) clearTimeout(this.backpressureTimer);
    this.backpressureTimer = undefined;
    this.paused = false;
    for (const off of this.unsubscribers.splice(0)) off();
  }

  private forward(data: Uint8Array): void {
    if (this.closed || data.byteLength === 0 || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.socket.close(1013, 'Workspace terminal consumer too slow');
      void this.close();
      return;
    }
    this.socket.send(data, { binary: true });
    if (this.socket.bufferedAmount >= HIGH_WATER_BYTES) this.pauseForBackpressure();
  }

  private pauseForBackpressure(): void {
    if (this.paused || !this.session) return;
    this.paused = true;
    this.session.pause();
    const poll = () => {
      this.backpressureTimer = undefined;
      if (this.closed || !this.session) return;
      if (this.socket.readyState !== WebSocket.OPEN) {
        void this.close();
        return;
      }
      if (this.socket.bufferedAmount >= HIGH_WATER_BYTES) {
        this.backpressureTimer = setTimeout(poll, BACKPRESSURE_POLL_MS);
        this.backpressureTimer.unref?.();
        return;
      }
      this.paused = false;
      this.session.resume();
    };
    this.backpressureTimer = setTimeout(poll, BACKPRESSURE_POLL_MS);
    this.backpressureTimer.unref?.();
  }
}
