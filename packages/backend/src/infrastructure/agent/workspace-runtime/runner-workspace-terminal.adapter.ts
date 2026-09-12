import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type {
  WorkspaceRuntimeInteractiveSession,
  WorkspaceRuntimeInteractiveSessionPort,
  WorkspaceRuntimeInteractiveSessionRequest,
} from '../../../modules/agent/workspace-runtime/workspace-runtime-interactive-session.port';
import { RunnerWebSocketDuplex } from './runner-websocket-duplex';

const ALLOWED_SIGNALS = new Set(['INT', 'TERM', 'HUP', 'QUIT', 'KILL', 'USR1', 'USR2']);

interface RunnerTerminalTunnel {
  openTerminalWebSocket(
    workspaceId: string,
    generation: number,
    columns: number,
    rows: number,
    signal?: AbortSignal,
  ): Promise<WebSocket>;
}

class RunnerWorkspaceTerminalSession implements WorkspaceRuntimeInteractiveSession {
  private readonly events = new EventEmitter();
  private closed = false;

  constructor(
    readonly workspaceId: string,
    readonly generation: number,
    private readonly socket: WebSocket,
    private readonly tunnel: RunnerWebSocketDuplex,
  ) {
    socket.once('close', () => this.finish());
    socket.once('error', (error) => this.events.emit('error', error));
    tunnel.once('close', () => this.finish());
    tunnel.once('error', (error) =>
      this.events.emit('error', error instanceof Error ? error : new Error(String(error))),
    );
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === WebSocket.OPEN && !this.tunnel.destroyed;
  }

  write(data: string | Uint8Array): boolean {
    if (!this.isOpen) return false;
    return this.tunnel.write(typeof data === 'string' ? Buffer.from(data) : Buffer.from(data));
  }

  resize(columns: number, rows: number): void {
    if (!this.isOpen) return;
    this.socket.send(JSON.stringify({ type: 'resize', columns, rows }));
  }

  signal(signal: string): void {
    if (!this.isOpen) return;
    const normalized = signal.toUpperCase().replace(/^SIG/, '');
    if (!ALLOWED_SIGNALS.has(normalized)) throw new Error('VALIDATION_FAILED');
    this.socket.send(JSON.stringify({ type: 'signal', signal: normalized }));
  }

  pause(): void {
    this.tunnel.pause();
  }

  resume(): void {
    this.tunnel.resume();
  }

  onDrain(listener: () => void): () => void {
    this.tunnel.on('drain', listener);
    return () => this.tunnel.off('drain', listener);
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    const next = (data: Buffer) => listener(data);
    this.tunnel.on('data', next);
    return () => this.tunnel.off('data', next);
  }

  onStderr(_listener: (data: Uint8Array) => void): () => void {
    // PTY 会合并 shell 的 stdout/stderr；helper 自己的 stderr 仅用于 Runner 诊断。
    return () => undefined;
  }

  onClose(listener: () => void): () => void {
    this.events.on('close', listener);
    return () => this.events.off('close', listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on('error', listener);
    return () => this.events.off('error', listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'close' }));
      this.socket.close(1000, 'Workspace terminal closed');
    }
    this.tunnel.destroy();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.events.emit('close');
    this.events.removeAllListeners();
  }
}

export class RunnerWorkspaceTerminalAdapter implements WorkspaceRuntimeInteractiveSessionPort {
  private readonly active = new Set<RunnerWorkspaceTerminalSession>();

  constructor(private readonly tunnels: RunnerTerminalTunnel) {}

  async open(
    request: WorkspaceRuntimeInteractiveSessionRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceRuntimeInteractiveSession> {
    if (signal?.aborted) throw signal.reason ?? new Error('ABORTED');
    const socket = await this.tunnels.openTerminalWebSocket(
      request.workspaceId,
      request.generation,
      request.columns,
      request.rows,
      signal,
    );
    const tunnel = new RunnerWebSocketDuplex(socket);
    const session = new RunnerWorkspaceTerminalSession(request.workspaceId, request.generation, socket, tunnel);
    this.active.add(session);
    session.onClose(() => this.active.delete(session));
    return session;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.active].map((session) => session.close().catch(() => undefined)));
    this.active.clear();
  }
}
