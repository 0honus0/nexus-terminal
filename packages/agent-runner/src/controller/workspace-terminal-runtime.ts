import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { runnerLog } from '../logging';
import type { RunnerJournal } from './journal';
import type { WorkspaceRuntimeEngine } from './workspace-runtime-engine';

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_SOCKET_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_CONTROL_BYTES = 8 * 1024;
const TERMINATE_GRACE_MS = 2_000;
const SIGNAL_BOOTSTRAP_RETRIES = 100;
const SIGNAL_BOOTSTRAP_DELAY_MS = 10;
const ALLOWED_SIGNALS = new Set(['INT', 'TERM', 'HUP', 'QUIT', 'KILL', 'USR1', 'USR2']);

type AllowedSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGQUIT' | 'SIGKILL' | 'SIGUSR1' | 'SIGUSR2';

interface ActiveTerminal {
  workspaceId: string;
  generation: number;
  close(): void;
}

interface TerminalControl {
  type: 'resize' | 'signal' | 'close';
  columns?: number;
  rows?: number;
  signal?: string;
}

const WRAPPER = `#!/bin/sh
set -eu
terminal_tty=$(tty)
case "$terminal_tty" in
  /dev/pts/[0-9]*) ;;
  *) exit 70 ;;
esac
printf '%s\n' "$$" > "$NEXUS_TERMINAL_SHELL_PID_FILE"
printf '%s\n' "$terminal_tty" > "$NEXUS_TERMINAL_TTY_FILE"
if read -r columns rows < "$NEXUS_TERMINAL_SIZE_FILE"; then
  case "$columns:$rows" in
    *[!0-9:]*|:*|*:) ;;
    *) stty cols "$columns" rows "$rows" < /dev/tty ;;
  esac
fi
exec "$NEXUS_TERMINAL_SHELL" -l
`;

const readPid = (file: string): number | null => {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
};

interface LinuxProcessStat {
  processGroupId: number;
  sessionId: number;
  foregroundProcessGroupId: number;
}

/** Linux /proc stat fields after `(comm)`: state, ppid, pgrp, session, tty_nr, tpgid, ... */
const readLinuxProcessStat = (pid: number): LinuxProcessStat | null => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const end = stat.lastIndexOf(')');
    if (end < 0) return null;
    const fields = stat
      .slice(end + 2)
      .trim()
      .split(/\s+/);
    const processGroupId = Number(fields[2]);
    const sessionId = Number(fields[3]);
    const foregroundProcessGroupId = Number(fields[5]);
    if (
      !Number.isSafeInteger(processGroupId) ||
      processGroupId < 1 ||
      !Number.isSafeInteger(sessionId) ||
      sessionId < 1 ||
      !Number.isSafeInteger(foregroundProcessGroupId)
    ) {
      return null;
    }
    return { processGroupId, sessionId, foregroundProcessGroupId };
  } catch {
    return null;
  }
};

const readTerminalPath = (file: string): string | null => {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return /^\/dev\/pts\/\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
};

const processGroupsForSession = (sessionId: number): Set<number> => {
  const groups = new Set<number>();
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return groups;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = readLinuxProcessStat(Number(entry));
    if (stat?.sessionId === sessionId && stat.processGroupId > 1) groups.add(stat.processGroupId);
  }
  return groups;
};

/**
 * 单用户 Runner 的 direct PTY runtime。
 *
 * util-linux script(1) 只负责分配 PTY；Node 负责认证 WebSocket、字节流、resize、
 * process-group signal、backpressure 与生命周期。这里不引入 SSH/Dropbear、native addon
 * 或自编译 helper。
 */
export class WorkspaceTerminalRuntime {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private readonly active = new Set<ActiveTerminal>();

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
    columns: number,
    rows: number,
  ): void {
    const workspace = this.journal.workspace(workspaceId);
    if (!workspace || workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
    this.validateViewport(columns, rows);
    const execution = this.runtime.prepareTerminalProcess(workspaceId, generation);
    this.server.handleUpgrade(request, socket, head, (websocket) =>
      this.attach(websocket, execution, workspaceId, generation, columns, rows),
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
    execution: ReturnType<WorkspaceRuntimeEngine['prepareTerminalProcess']>,
    workspaceId: string,
    generation: number,
    columns: number,
    rows: number,
  ): void {
    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-terminal-'));
    const wrapper = path.join(sessionRoot, 'shell.sh');
    const sizeFile = path.join(sessionRoot, 'size');
    const shellPidFile = path.join(sessionRoot, 'shell.pid');
    const ttyFile = path.join(sessionRoot, 'tty');
    fs.writeFileSync(wrapper, WRAPPER, { mode: 0o700 });
    fs.writeFileSync(sizeFile, `${columns} ${rows}\n`, { mode: 0o600 });

    const child = spawn('script', ['-qefc', `exec /bin/sh ${wrapper}`, '/dev/null'], {
      cwd: execution.cwd,
      env: {
        ...execution.env,
        NEXUS_TERMINAL_SHELL: execution.file,
        NEXUS_TERMINAL_SIZE_FILE: sizeFile,
        NEXUS_TERMINAL_SHELL_PID_FILE: shellPidFile,
        NEXUS_TERMINAL_TTY_FILE: ttyFile,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let closing = false;
    let finished = false;
    let killTimer: NodeJS.Timeout | null = null;
    const cleanup = (): void => fs.rmSync(sessionRoot, { recursive: true, force: true });

    let terminalSessionId: number | null = null;
    const shellPid = (): number | null => readPid(shellPidFile);
    const resolveTerminalSessionId = (): number | null => {
      if (terminalSessionId) return terminalSessionId;
      const pid = shellPid();
      if (!pid) return null;
      const stat = readLinuxProcessStat(pid);
      if (!stat) return null;
      const runnerSessionId = readLinuxProcessStat(process.pid)?.sessionId ?? null;
      if (runnerSessionId !== null && stat.sessionId === runnerSessionId) return null;
      terminalSessionId = stat.sessionId;
      return terminalSessionId;
    };

    const signalForegroundGroup = (signal: NodeJS.Signals): boolean => {
      const pid = shellPid();
      if (!pid) return false;
      const group = readLinuxProcessStat(pid)?.foregroundProcessGroupId ?? 0;
      if (group <= 1) return false;
      try {
        process.kill(-group, signal);
        return true;
      } catch {
        return false;
      }
    };

    const signalTerminalSession = (signal: NodeJS.Signals): boolean => {
      const sessionId = resolveTerminalSessionId();
      if (!sessionId) return false;
      const runnerGroupId = readLinuxProcessStat(process.pid)?.processGroupId ?? null;
      let signaled = false;
      for (const group of processGroupsForSession(sessionId)) {
        if (runnerGroupId !== null && group === runnerGroupId) continue;
        try {
          process.kill(-group, signal);
          signaled = true;
        } catch {
          // 进程可能在 /proc 扫描与 signal 之间退出。
        }
      }
      return signaled;
    };

    const signalForegroundSoon = (signal: AllowedSignal, attempt = 0): void => {
      if (finished || signalForegroundGroup(signal)) return;
      if (attempt >= SIGNAL_BOOTSTRAP_RETRIES) {
        runnerLog('warn', 'Workspace terminal foreground process group was unavailable', {
          workspaceId,
          generation,
          signal,
        });
        return;
      }
      const timer = setTimeout(() => signalForegroundSoon(signal, attempt + 1), SIGNAL_BOOTSTRAP_DELAY_MS);
      timer.unref?.();
    };

    const signalSessionSoon = (signal: NodeJS.Signals, attempt = 0): void => {
      if (finished || signalTerminalSession(signal)) return;
      if (attempt >= SIGNAL_BOOTSTRAP_RETRIES) return;
      const timer = setTimeout(() => signalSessionSoon(signal, attempt + 1), SIGNAL_BOOTSTRAP_DELAY_MS);
      timer.unref?.();
    };

    const applyTerminalSize = (nextColumns: number, nextRows: number): boolean => {
      const terminal = readTerminalPath(ttyFile);
      if (!terminal) return false;
      let fd: number | null = null;
      try {
        fd = fs.openSync(terminal, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
        const result = spawnSync('stty', ['cols', String(nextColumns), 'rows', String(nextRows)], {
          stdio: [fd, 'ignore', 'ignore'],
        });
        if (result.status !== 0) return false;
        signalForegroundGroup('SIGWINCH');
        return true;
      } catch {
        return false;
      } finally {
        if (fd !== null) fs.closeSync(fd);
      }
    };

    const applyTerminalSizeSoon = (nextColumns: number, nextRows: number, attempt = 0): void => {
      if (finished || applyTerminalSize(nextColumns, nextRows)) return;
      if (attempt >= SIGNAL_BOOTSTRAP_RETRIES) {
        runnerLog('warn', 'Workspace terminal resize target was unavailable', {
          workspaceId,
          generation,
          columns: nextColumns,
          rows: nextRows,
        });
        return;
      }
      const timer = setTimeout(
        () => applyTerminalSizeSoon(nextColumns, nextRows, attempt + 1),
        SIGNAL_BOOTSTRAP_DELAY_MS,
      );
      timer.unref?.();
    };

    const captureSessionSoon = (attempt = 0): void => {
      if (finished || resolveTerminalSessionId()) return;
      if (attempt >= SIGNAL_BOOTSTRAP_RETRIES) return;
      const timer = setTimeout(() => captureSessionSoon(attempt + 1), SIGNAL_BOOTSTRAP_DELAY_MS);
      timer.unref?.();
    };
    captureSessionSoon();

    const active: ActiveTerminal = {
      workspaceId,
      generation,
      close: () => {
        if (closing || finished) return;
        closing = true;
        this.active.delete(active);
        signalSessionSoon('SIGTERM');
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (finished) return;
          signalTerminalSession('SIGKILL');
          child.kill('SIGKILL');
        }, TERMINATE_GRACE_MS);
        killTimer.unref?.();
        if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
          websocket.close(1001, 'WORKSPACE_TERMINAL_CLOSED');
        }
      },
    };
    this.active.add(active);

    websocket.on('message', (data, isBinary) => {
      if (closing || finished) return;
      if (isBinary) {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (bytes.byteLength > MAX_FRAME_BYTES || !child.stdin.writable) {
          active.close();
          return;
        }
        if (!child.stdin.write(bytes)) websocket.pause();
        return;
      }
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) {
        websocket.close(1008, 'WORKSPACE_TERMINAL_CONTROL_INVALID');
        active.close();
        return;
      }
      try {
        const message = JSON.parse(text) as TerminalControl;
        if (message.type === 'close') {
          active.close();
          return;
        }
        if (message.type === 'resize') {
          const nextColumns = Number(message.columns);
          const nextRows = Number(message.rows);
          this.validateViewport(nextColumns, nextRows);
          fs.writeFileSync(sizeFile, `${nextColumns} ${nextRows}\n`, { mode: 0o600 });
          // shell 尚未 exec 时 wrapper 会读取最新尺寸；exec 后则直接更新同一个 PTY slave。
          applyTerminalSizeSoon(nextColumns, nextRows);
          return;
        }
        if (message.type === 'signal' && typeof message.signal === 'string') {
          const name = message.signal.toUpperCase().replace(/^SIG/, '');
          if (!ALLOWED_SIGNALS.has(name)) throw new Error('VALIDATION_FAILED');
          signalForegroundSoon(`SIG${name}` as AllowedSignal);
          return;
        }
        throw new Error('VALIDATION_FAILED');
      } catch {
        websocket.close(1008, 'WORKSPACE_TERMINAL_CONTROL_INVALID');
        active.close();
      }
    });

    child.stdin.on('drain', () => websocket.resume());
    websocket.on('close', () => active.close());
    websocket.on('error', () => active.close());

    child.stdout.on('data', (chunk: Buffer) => {
      if (closing || finished || websocket.readyState !== WebSocket.OPEN) return;
      if (websocket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
        websocket.close(1013, 'WORKSPACE_TERMINAL_OUTPUT_BACKPRESSURE');
        active.close();
        return;
      }
      websocket.send(chunk, { binary: true });
    });
    child.stderr.resume();
    child.once('error', (error) => {
      runnerLog('warn', 'Workspace terminal process failed to start', {
        workspaceId,
        generation,
        errorCode: error.message,
      });
      if (websocket.readyState === WebSocket.OPEN) websocket.close(1011, 'WORKSPACE_TERMINAL_PROCESS_FAILED');
      active.close();
    });
    child.once('close', (code, signal) => {
      if (finished) return;
      // shell 正常退出也要清理同 PTY session 内被 disown/后台化的剩余进程。
      signalTerminalSession('SIGKILL');
      finished = true;
      this.active.delete(active);
      if (killTimer) clearTimeout(killTimer);
      cleanup();
      runnerLog('debug', 'Workspace terminal process exited', {
        workspaceId,
        generation,
        exitCode: code,
        signal,
      });
      if (!closing && websocket.readyState === WebSocket.OPEN) {
        websocket.close(
          code === 0 ? 1000 : 1011,
          code === 0 ? 'WORKSPACE_TERMINAL_EXITED' : `WORKSPACE_TERMINAL_EXIT_${code ?? signal ?? 'UNKNOWN'}`,
        );
      }
    });
  }

  private validateViewport(columns: number, rows: number): void {
    if (
      !Number.isSafeInteger(columns) ||
      !Number.isSafeInteger(rows) ||
      columns < 2 ||
      rows < 1 ||
      columns > 1000 ||
      rows > 500
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }
}
