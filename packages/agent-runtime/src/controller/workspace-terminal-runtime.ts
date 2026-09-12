import { spawn } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RunnerJournal } from './journal';
import type { SandboxEngine } from './sandbox-engine';

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_SOCKET_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

interface ActiveTerminal {
  workspaceId: string;
  generation: number;
  close(): void;
}

/**
 * Bridges one authenticated Runner WebSocket to one SSH byte stream created
 * inside the Workspace sandbox. Dropbear owns SSH/PTTY semantics; this class
 * never interprets terminal bytes and never exposes a TCP listener outside the
 * sandbox network namespace.
 */
export class WorkspaceTerminalRuntime {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private readonly active = new Set<ActiveTerminal>();

  constructor(
    private readonly journal: RunnerJournal,
    private readonly sandbox: SandboxEngine,
  ) {}

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    workspaceId: string,
    generation: number,
    authorizedKey: string,
  ): void {
    const workspace = this.journal.workspace(workspaceId);
    if (!workspace || !workspace.sandboxId || workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
    const execution = this.sandbox.prepareTerminalProcess(workspace.sandboxId, workspaceId, generation, authorizedKey);
    this.server.handleUpgrade(request, socket, head, (websocket) =>
      this.attach(websocket, execution, workspaceId, generation),
    );
  }

  closeWorkspace(workspaceId: string, generation?: number): void {
    for (const terminal of [...this.active]) {
      if (terminal.workspaceId === workspaceId && (generation === undefined || terminal.generation === generation)) {
        terminal.close();
      }
    }
  }

  closeAll(): void {
    for (const terminal of [...this.active]) terminal.close();
  }

  private attach(
    websocket: WebSocket,
    execution: ReturnType<SandboxEngine['prepareTerminalProcess']>,
    workspaceId: string,
    generation: number,
  ): void {
    const child = spawn(execution.file, execution.argv, {
      cwd: execution.cwd,
      env: execution.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let closed = false;
    let stderr = Buffer.alloc(0);
    const active: ActiveTerminal = {
      workspaceId,
      generation,
      close: () => {
        if (closed) return;
        closed = true;
        this.active.delete(active);
        child.kill('SIGTERM');
        execution.cleanup();
        if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
          websocket.close(1001, 'WORKSPACE_TERMINAL_CLOSED');
        }
      },
    };
    this.active.add(active);

    websocket.on('message', (data, isBinary) => {
      if (!isBinary || closed) {
        websocket.close(1003, 'WORKSPACE_TERMINAL_BINARY_REQUIRED');
        return;
      }
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (bytes.byteLength > MAX_FRAME_BYTES || !child.stdin.writable) {
        active.close();
        return;
      }
      if (!child.stdin.write(bytes)) {
        websocket.close(1013, 'WORKSPACE_TERMINAL_INPUT_BACKPRESSURE');
        active.close();
      }
    });
    websocket.on('close', () => active.close());
    websocket.on('error', () => active.close());

    child.stdout.on('data', (chunk: Buffer) => {
      if (closed || websocket.readyState !== WebSocket.OPEN) return;
      if (websocket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
        websocket.close(1013, 'WORKSPACE_TERMINAL_OUTPUT_BACKPRESSURE');
        active.close();
        return;
      }
      websocket.send(chunk, { binary: true });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.byteLength >= MAX_STDERR_BYTES) return;
      stderr = Buffer.concat([stderr, chunk.subarray(0, MAX_STDERR_BYTES - stderr.byteLength)]);
    });
    child.on('error', () => {
      if (websocket.readyState === WebSocket.OPEN) websocket.close(1011, 'WORKSPACE_TERMINAL_PROCESS_FAILED');
      active.close();
    });
    child.on('exit', (code, signal) => {
      if (closed) return;
      closed = true;
      this.active.delete(active);
      execution.cleanup();
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close(
          code === 0 ? 1000 : 1011,
          code === 0 ? 'WORKSPACE_TERMINAL_EXITED' : `WORKSPACE_TERMINAL_EXIT_${code ?? signal ?? 'UNKNOWN'}`,
        );
      }
    });
  }
}
