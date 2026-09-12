import { EventEmitter } from 'node:events';
import { Client, type ClientChannel, utils } from 'ssh2';
import type {
  WorkspaceRuntimeInteractiveSession,
  WorkspaceRuntimeInteractiveSessionPort,
  WorkspaceRuntimeInteractiveSessionRequest,
} from '../../../modules/agent/workspace-runtime/workspace-runtime-interactive-session.port';
import { SshShellSessionAdapter } from '../../ssh/execution/ssh-shell-session.adapter';
import { RunnerWebSocketDuplex } from './runner-websocket-duplex';
import type WebSocket from 'ws';

const READY_TIMEOUT_MS = 15_000;
interface RunnerTerminalTunnel {
  openTerminalWebSocket(
    workspaceId: string,
    generation: number,
    publicKey: string,
    signal?: AbortSignal,
  ): Promise<WebSocket>;
}

const ALLOWED_SIGNALS = new Set(['INT', 'TERM', 'HUP', 'QUIT', 'KILL', 'USR1', 'USR2']);

class RunnerWorkspaceTerminalSession implements WorkspaceRuntimeInteractiveSession {
  private readonly events = new EventEmitter();
  private closed = false;

  constructor(
    readonly workspaceId: string,
    readonly generation: number,
    private readonly client: Client,
    private readonly tunnel: RunnerWebSocketDuplex,
    private readonly shell: SshShellSessionAdapter,
  ) {
    shell.onClose(() => this.events.emit('close'));
    shell.onError((error) => this.events.emit('error', error));
  }

  get isOpen(): boolean {
    return !this.closed && this.shell.isOpen;
  }

  write(data: string | Uint8Array): boolean {
    return this.shell.write(data);
  }
  resize(columns: number, rows: number): void {
    this.shell.resize(columns, rows);
  }
  signal(signal: string): void {
    const normalized = signal.toUpperCase().replace(/^SIG/, '');
    if (!ALLOWED_SIGNALS.has(normalized)) throw new Error('VALIDATION_FAILED');
    this.shell.signal(normalized);
  }
  pause(): void {
    this.shell.pause();
  }
  resume(): void {
    this.shell.resume();
  }
  onDrain(listener: () => void): () => void {
    return this.shell.onDrain(listener);
  }
  onData(listener: (data: Uint8Array) => void): () => void {
    return this.shell.onData(listener);
  }
  onStderr(listener: (data: Uint8Array) => void): () => void {
    return this.shell.onStderr(listener);
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
    this.closed = true;
    this.shell.close();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.client.removeListener('close', finish);
        resolve();
      };
      const timer = setTimeout(finish, 750);
      timer.unref?.();
      this.client.once('close', finish);
      try {
        this.client.end();
      } catch {
        finish();
      }
    });
    this.tunnel.destroy();
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
    const keys = utils.generateKeyPairSync('ed25519');
    const socket = await this.tunnels.openTerminalWebSocket(
      request.workspaceId,
      request.generation,
      keys.public.trim(),
      signal,
    );
    const tunnel = new RunnerWebSocketDuplex(socket);
    const client = new Client();
    let shell: SshShellSessionAdapter | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          client.end();
          reject(signal?.reason ?? new Error('ABORTED'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        client.once('ready', () => {
          cleanup();
          resolve();
        });
        client.once('error', (error) => {
          cleanup();
          reject(error);
        });
        client.connect({
          sock: tunnel,
          username: 'nexus',
          privateKey: keys.private,
          hostVerifier: () => true,
          readyTimeout: READY_TIMEOUT_MS,
          keepaliveInterval: 15_000,
          keepaliveCountMax: 2,
        });
      });
      const channel = await new Promise<ClientChannel>((resolve, reject) => {
        client.shell(
          {
            term: 'xterm-256color',
            cols: request.columns,
            rows: request.rows,
          },
          (error, next) => (error ? reject(error) : resolve(next)),
        );
      });
      shell = new SshShellSessionAdapter(channel);
      const session = new RunnerWorkspaceTerminalSession(
        request.workspaceId,
        request.generation,
        client,
        tunnel,
        shell,
      );
      this.active.add(session);
      session.onClose(() => this.active.delete(session));
      return session;
    } catch (error) {
      shell?.close();
      client.end();
      tunnel.destroy();
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.active].map((session) => session.close().catch(() => undefined)));
    this.active.clear();
  }
}
