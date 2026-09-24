import { spawn } from 'node:child_process';
import {
  MANAGED_PROCESS_DETACHED,
  registerManagedProcess,
  signalManagedProcess,
  terminateManagedProcess,
} from '../managed-process';
import { runnerLog } from '../logging';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RunnerJournal } from './journal';
import type { WorkspaceRuntimeEngine } from './workspace-runtime-engine';

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
const MAX_STDERR_LOG_BYTES = 4 * 1024;

interface ActiveProcess {
  workspaceId: string;
  generation: number;
  close(): Promise<void>;
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
    const releaseWriter = this.runtime.acquireWorkspaceWriter(workspaceId, generation);
    try {
      this.server.handleUpgrade(request, socket, head, (websocket) =>
        this.attach(websocket, execution, workspaceId, generation, releaseWriter),
      );
    } catch (error) {
      releaseWriter();
      throw error;
    }
  }

  async closeWorkspace(workspaceId: string, generation?: number): Promise<void> {
    await Promise.all(
      [...this.active]
        .filter(
          (process) =>
            process.workspaceId === workspaceId && (generation === undefined || process.generation === generation),
        )
        .map((process) => process.close()),
    );
  }

  closeAll(): void {
    for (const process of [...this.active]) void process.close().catch(() => undefined);
  }

  private attach(
    websocket: WebSocket,
    execution: { file: string; argv: string[]; cwd: string; env: NodeJS.ProcessEnv },
    workspaceId: string,
    generation: number,
    releaseWriter: () => void,
  ): void {
    const child = spawn(execution.file, execution.argv, {
      cwd: execution.cwd,
      env: execution.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: MANAGED_PROCESS_DETACHED,
    });
    try {
      registerManagedProcess(child, 'acp', `${workspaceId}:${generation}`);
    } catch (error) {
      releaseWriter();
      throw error;
    }
    let stderrTail = '';
    let closed = false;
    let closePromise: Promise<void> | null = null;
    let writerReleased = false;
    const releaseOwnership = (): void => {
      if (writerReleased) return;
      writerReleased = true;
      releaseWriter();
    };
    const active: ActiveProcess = {
      workspaceId,
      generation,
      close: () => {
        if (closePromise) return closePromise;
        closed = true;
        if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)
          websocket.close(1001);
        closePromise = terminateManagedProcess(child).then(() => {
          this.active.delete(active);
          releaseOwnership();
        });
        return closePromise;
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
        void active.close().catch(() => undefined);
        return;
      }
      child.stdin.write(bytes);
    });
    websocket.on('close', () => void active.close().catch(() => undefined));
    websocket.on('error', () => void active.close().catch(() => undefined));

    child.stdout.on('data', (chunk: Buffer) => {
      if (closed || websocket.readyState !== WebSocket.OPEN) return;
      if (websocket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
        websocket.close(1013, 'ACP_BACKPRESSURE');
        void active.close().catch(() => undefined);
        return;
      }
      websocket.send(chunk, { binary: true });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail += chunk.toString('utf8');
      if (Buffer.byteLength(stderrTail, 'utf8') > MAX_STDERR_LOG_BYTES) {
        stderrTail = Buffer.from(stderrTail, 'utf8').subarray(-MAX_STDERR_LOG_BYTES).toString('utf8');
      }
    });
    child.on('error', (error) => {
      runnerLog('warn', 'ACP process failed to start', {
        workspaceId,
        generation,
        errorCode: error.message,
        stderrTail: stderrTail || undefined,
      });
      if (websocket.readyState === WebSocket.OPEN) websocket.close(1011, 'ACP_PROCESS_FAILED');
      void active.close().catch(() => undefined);
    });
    child.on('exit', (code, signal) => {
      signalManagedProcess(child, 'SIGKILL');
      if (closed) return;
      closed = true;
      this.active.delete(active);
      releaseOwnership();
      runnerLog(code === 0 ? 'debug' : 'warn', 'ACP process exited', {
        workspaceId,
        generation,
        exitCode: code,
        signal,
        stderrTail: stderrTail || undefined,
      });
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close(
          code === 0 ? 1000 : 1011,
          code === 0 ? 'ACP_PROCESS_EXITED' : `ACP_PROCESS_EXIT_${code ?? signal ?? 'UNKNOWN'}`,
        );
      }
    });
  }
}
