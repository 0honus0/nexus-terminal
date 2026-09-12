import { spawn } from 'node:child_process';
import { MANAGED_PROCESS_DETACHED, signalManagedProcess, terminateManagedProcess } from '../managed-process';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RunnerJournal } from './journal';
import type { WorkspaceRuntimeEngine } from './workspace-runtime-engine';

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;

interface ActiveProcess {
  workspaceId: string;
  generation: number;
  close(): void;
}

export class AcpProcessRuntime {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private readonly active = new Set<ActiveProcess>();

  constructor(
    private readonly journal: RunnerJournal,
    private readonly runtime: WorkspaceRuntimeEngine,
  ) {}

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    workspaceId: string,
    generation: number,
    profileId: string,
  ): void {
    const workspace = this.journal.workspace(workspaceId);
    if (!workspace || workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
    const profile = workspace.acpProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error('ACP_PROFILE_NOT_FOUND');
    const execution = this.runtime.prepareAcpProcess(workspaceId, generation, profile.argv, profile.cwd);
    this.server.handleUpgrade(request, socket, head, (websocket) =>
      this.attach(websocket, execution, workspaceId, generation),
    );
  }

  closeWorkspace(workspaceId: string, generation?: number): void {
    for (const process of [...this.active]) {
      if (process.workspaceId === workspaceId && (generation === undefined || process.generation === generation))
        process.close();
    }
  }

  closeAll(): void {
    for (const process of [...this.active]) process.close();
  }

  private attach(
    websocket: WebSocket,
    execution: { file: string; argv: string[]; cwd: string; env: NodeJS.ProcessEnv },
    workspaceId: string,
    generation: number,
  ): void {
    const child = spawn(execution.file, execution.argv, {
      cwd: execution.cwd,
      env: execution.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: MANAGED_PROCESS_DETACHED,
    });
    let closed = false;
    const active: ActiveProcess = {
      workspaceId,
      generation,
      close: () => {
        if (closed) return;
        closed = true;
        this.active.delete(active);
        void terminateManagedProcess(child);
        if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)
          websocket.close(1001);
      },
    };
    this.active.add(active);

    websocket.on('message', (data, isBinary) => {
      if (!isBinary || closed) {
        websocket.close(1003, 'ACP_BINARY_REQUIRED');
        return;
      }
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (bytes.byteLength > MAX_FRAME_BYTES || !child.stdin.writable) {
        active.close();
        return;
      }
      child.stdin.write(bytes);
    });
    websocket.on('close', () => active.close());
    websocket.on('error', () => active.close());

    child.stdout.on('data', (chunk: Buffer) => {
      if (closed || websocket.readyState !== WebSocket.OPEN) return;
      if (websocket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
        websocket.close(1013, 'ACP_BACKPRESSURE');
        active.close();
        return;
      }
      websocket.send(chunk, { binary: true });
    });
    child.stderr.resume();
    child.on('error', () => {
      if (websocket.readyState === WebSocket.OPEN) websocket.close(1011, 'ACP_PROCESS_FAILED');
      active.close();
    });
    child.on('exit', (code, signal) => {
      signalManagedProcess(child, 'SIGKILL');
      if (closed) return;
      closed = true;
      this.active.delete(active);
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close(
          code === 0 ? 1000 : 1011,
          code === 0 ? 'ACP_PROCESS_EXITED' : `ACP_PROCESS_EXIT_${code ?? signal ?? 'UNKNOWN'}`,
        );
      }
    });
  }
}
