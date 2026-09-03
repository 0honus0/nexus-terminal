import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import { quotePosixShellArg } from '../../../platform/execution/posix-shell';
import type { WorkspaceEventHub } from '../workspace-event-hub';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';

export type WorkspaceShellKind = 'bash' | 'zsh' | 'other';
export interface WorkspaceShellIntegrationSnapshot {
  shellPid?: number;
  shellKind?: WorkspaceShellKind;
  integrationReady?: boolean;
  atPrompt?: boolean;
}

interface PendingSetup {
  phase: 'probe' | 'hook';
  startMarker: string;
  endMarker: string;
  buffer: string;
  timeout: NodeJS.Timeout;
}
interface PendingDirectoryChange {
  requestId: string;
  requestedPath: string;
  expectedPath: string;
  executing: boolean;
  timeout: NodeJS.Timeout;
}
interface ShellState extends WorkspaceShellIntegrationSnapshot {
  probePromise?: Promise<void>;
  probeResolve?: () => void;
  probeReject?: (error: Error) => void;
  hookPromise?: Promise<void>;
  hookResolve?: () => void;
  hookReject?: (error: Error) => void;
  hookPromptTimeout?: NodeJS.Timeout;
  setup?: PendingSetup;
  controlRemainder: string;
  suppressOutputUntilPrompt: boolean;
  pendingDirectory?: PendingDirectoryChange;
}

const PROMPT_MARKER = '\x1b]777;NEXUS_PROMPT\x07';
const DELETED_CWD_SUFFIX = ' (deleted)';
const SETUP_TIMEOUT_MS = 5_000;
const DIRECTORY_TIMEOUT_MS = 10 * 60 * 1000;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const encodeForPrintf = (value: string) =>
  Array.from(value)
    .map((char) => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`)
    .join('');

/** Shell cooperation logic independent of WebSocket and ssh2. */
export class WorkspaceShellIntegrationService {
  private readonly states = new Map<string, ShellState>();
  constructor(
    private readonly workspaces: WorkspaceSessionRegistry,
    private readonly executions: ExecutionSessionManager,
    private readonly events: WorkspaceEventHub,
  ) {}

  filterOutput(sessionId: string, chunk: string): string {
    const state = this.state(sessionId);
    return this.consumePromptMarkers(sessionId, state, this.consumeSetupOutput(sessionId, state, chunk));
  }
  noteUserInput(sessionId: string): void {
    this.state(sessionId).atPrompt = false;
  }
  snapshot(sessionId: string): WorkspaceShellIntegrationSnapshot {
    const s = this.state(sessionId);
    return { shellPid: s.shellPid, shellKind: s.shellKind, integrationReady: s.integrationReady, atPrompt: s.atPrompt };
  }
  restore(sessionId: string, snapshot: WorkspaceShellIntegrationSnapshot): void {
    const state = this.state(sessionId);
    state.shellPid = snapshot.shellPid;
    state.shellKind = snapshot.shellKind;
    state.integrationReady = snapshot.integrationReady;
    state.atPrompt = snapshot.atPrompt;
  }
  clear(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    if (state.setup) clearTimeout(state.setup.timeout);
    if (state.hookPromptTimeout) clearTimeout(state.hookPromptTimeout);
    if (state.pendingDirectory) clearTimeout(state.pendingDirectory.timeout);
    this.states.delete(sessionId);
  }

  async readCurrentPath(sessionId: string): Promise<string> {
    await this.ensureProbe(sessionId);
    const state = this.state(sessionId);
    if (!state.shellPid) throw new Error('Shell PID is unavailable.');
    const execution = this.execution(sessionId);
    const current = this.parseDelimited(
      (
        await execution.execute({
          command: `printf '\\000'; readlink -n /proc/${state.shellPid}/cwd; nexus_status=$?; printf '\\000'; exit "$nexus_status"`,
          timeoutMs: 5_000,
        })
      ).stdout,
    );
    if (!current.endsWith(DELETED_CWD_SUFFIX)) return current;
    try {
      return await this.resolveRemoteDirectory(sessionId, current);
    } catch {
      /* kernel deleted suffix */
    }
    const deleted = current.slice(0, -DELETED_CWD_SUFFIX.length);
    let fallback = path.posix.dirname(deleted || '/');
    while (true) {
      try {
        return await this.resolveRemoteDirectory(sessionId, fallback);
      } catch {
        if (fallback === '/') break;
        fallback = path.posix.dirname(fallback);
      }
    }
    throw new Error('Terminal current directory was deleted and no existing parent directory could be resolved.');
  }

  async resolveRemoteDirectory(sessionId: string, requestedPath: string): Promise<string> {
    const execution = this.execution(sessionId);
    return this.parseDelimited(
      (
        await execution.execute({
          command: `cd -P ${quotePosixShellArg(requestedPath)} 2>/dev/null && printf '\\000%s\\000' "$PWD"`,
          timeoutMs: 5_000,
        })
      ).stdout,
    );
  }

  async requestDirectoryChange(sessionId: string, requestId: string, requestedPath: string): Promise<void> {
    if (!requestId || !requestedPath.startsWith('/') || CONTROL_CHARS.test(requestedPath)) {
      this.events.publish(sessionId, {
        type: 'directory-change-error',
        requestId,
        message: '无效的终端目录切换请求。',
      });
      return;
    }
    let expected: string;
    try {
      expected = await this.resolveRemoteDirectory(sessionId, requestedPath);
    } catch {
      this.events.publish(sessionId, {
        type: 'directory-change-error',
        requestId,
        message: '目标目录不存在或无权访问。',
      });
      return;
    }
    try {
      await this.ensurePromptHook(sessionId);
    } catch (error) {
      this.events.publish(sessionId, {
        type: 'directory-change-error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const state = this.state(sessionId);
    if ((state.shellKind !== 'bash' && state.shellKind !== 'zsh') || !state.integrationReady) {
      this.events.publish(sessionId, {
        type: 'directory-change-error',
        requestId,
        message: '当前 Shell 不支持安全目录队列；为避免影响前台程序，未发送 cd。',
      });
      return;
    }
    if (state.pendingDirectory) {
      const previous = state.pendingDirectory;
      this.clearPending(state);
      this.events.publish(sessionId, {
        type: 'directory-change-error',
        requestId: previous.requestId,
        message: '已被新的目录切换请求替代。',
      });
    }
    const timeout = setTimeout(() => {
      const latest = this.states.get(sessionId);
      if (latest?.pendingDirectory?.requestId !== requestId) return;
      this.clearPending(latest);
      this.events.publish(sessionId, {
        type: 'directory-change-error',
        requestId,
        message: '等待 Shell 返回提示符超时。',
      });
    }, DIRECTORY_TIMEOUT_MS);
    state.pendingDirectory = { requestId, requestedPath, expectedPath: expected, executing: false, timeout };
    this.events.publish(sessionId, {
      type: 'directory-change-queued',
      requestId,
      path: requestedPath,
      waitingForPrompt: !state.atPrompt,
    });
    if (state.atPrompt) await this.handlePrompt(sessionId, state);
  }

  async ensureProbe(sessionId: string): Promise<void> {
    const state = this.state(sessionId);
    if (state.shellPid) return;
    if (state.probePromise) return state.probePromise;
    const shell = this.workspace(sessionId).shell;
    const promise = new Promise<void>((resolve, reject) => {
      state.probeResolve = resolve;
      state.probeReject = reject;
    });
    state.probePromise = promise;
    const token = randomUUID().replace(/-/g, '');
    const start = `__NEXUS_SHELL_BEGIN_${token}__`,
      end = `__NEXUS_SHELL_END_${token}__`;
    const timeout = setTimeout(() => {
      state.setup = undefined;
      this.rejectProbe(state, new Error('终端路径探测超时。'));
    }, SETUP_TIMEOUT_MS);
    state.integrationReady = false;
    state.setup = { phase: 'probe', startMarker: start, endMarker: end, buffer: '', timeout };
    try {
      shell.write(this.buildProbeCommand(start, end));
    } catch (error) {
      clearTimeout(timeout);
      state.setup = undefined;
      this.rejectProbe(state, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  async ensurePromptHook(sessionId: string): Promise<void> {
    await this.ensureProbe(sessionId);
    const state = this.state(sessionId);
    if (state.integrationReady) return;
    if (state.hookPromise) return state.hookPromise;
    if (state.shellKind !== 'bash' && state.shellKind !== 'zsh')
      throw new Error('当前 Shell 不支持安全目录队列；为避免影响前台程序，未发送 cd。');
    const shell = this.workspace(sessionId).shell;
    const promise = new Promise<void>((resolve, reject) => {
      state.hookResolve = resolve;
      state.hookReject = reject;
    });
    state.hookPromise = promise;
    const token = randomUUID().replace(/-/g, '');
    const start = `__NEXUS_HOOK_BEGIN_${token}__`,
      end = `__NEXUS_HOOK_END_${token}__`;
    const timeout = setTimeout(() => {
      state.setup = undefined;
      this.rejectHook(state, new Error('终端提示符集成初始化超时。'));
    }, SETUP_TIMEOUT_MS);
    state.setup = { phase: 'hook', startMarker: start, endMarker: end, buffer: '', timeout };
    try {
      shell.write(this.buildHookCommand(state.shellKind, start, end));
    } catch (error) {
      clearTimeout(timeout);
      state.setup = undefined;
      this.rejectHook(state, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  private state(id: string): ShellState {
    let state = this.states.get(id);
    if (!state) {
      state = { controlRemainder: '', suppressOutputUntilPrompt: false };
      this.states.set(id, state);
    }
    return state;
  }
  private workspace(id: string) {
    return this.workspaces.require(id);
  }
  private execution(id: string) {
    return this.executions.require(this.workspace(id).executionSessionId);
  }
  private parseDelimited(output: string) {
    const start = output.indexOf('\0'),
      end = start >= 0 ? output.indexOf('\0', start + 1) : -1;
    if (start < 0 || end < 0) throw new Error('Remote command did not return a delimited path.');
    const value = output.slice(start + 1, end);
    if (!value.startsWith('/')) throw new Error('Remote command did not return an absolute path.');
    return value;
  }
  private clearPending(state: ShellState) {
    if (state.pendingDirectory) clearTimeout(state.pendingDirectory.timeout);
    state.pendingDirectory = undefined;
  }
  private async handlePrompt(sessionId: string, state: ShellState) {
    const pending = state.pendingDirectory;
    if (!pending) return;
    const shell = this.workspace(sessionId).shell;
    if (!pending.executing) {
      pending.executing = true;
      state.atPrompt = false;
      state.suppressOutputUntilPrompt = true;
      shell.write(`\x15cd ${quotePosixShellArg(pending.requestedPath)}\r`);
      return;
    }
    this.clearPending(state);
    try {
      const current = await this.readCurrentPath(sessionId);
      if (current !== pending.expectedPath) throw new Error(`Shell remained in ${current}`);
      this.events.publish(sessionId, { type: 'directory-change-result', requestId: pending.requestId, path: current });
    } catch (error) {
      this.events.publish(sessionId, {
        type: 'directory-change-error',
        requestId: pending.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  private consumePromptMarkers(sessionId: string, state: ShellState, chunk: string): string {
    const data = state.controlRemainder + chunk;
    state.controlRemainder = '';
    let visible = '',
      cursor = 0,
      marker = data.indexOf(PROMPT_MARKER);
    while (marker !== -1) {
      if (state.suppressOutputUntilPrompt) {
        visible += '\r\x1b[2K';
        state.suppressOutputUntilPrompt = false;
      } else visible += data.slice(cursor, marker);
      state.atPrompt = true;
      state.integrationReady = true;
      if (state.hookPromise) this.resolveHook(state);
      void this.handlePrompt(sessionId, state);
      cursor = marker + PROMPT_MARKER.length;
      marker = data.indexOf(PROMPT_MARKER, cursor);
    }
    const tail = data.slice(cursor);
    let partial = 0;
    for (let length = Math.min(tail.length, PROMPT_MARKER.length - 1); length > 0; length--)
      if (PROMPT_MARKER.startsWith(tail.slice(-length))) {
        partial = length;
        break;
      }
    const complete = partial ? tail.slice(0, -partial) : tail;
    if (!state.suppressOutputUntilPrompt) visible += complete;
    if (partial) state.controlRemainder = tail.slice(-partial);
    return visible;
  }
  private consumeSetupOutput(_sessionId: string, state: ShellState, chunk: string): string {
    const pending = state.setup;
    if (!pending) return chunk;
    pending.buffer += chunk;
    const start = pending.buffer.indexOf(pending.startMarker);
    if (start === -1) {
      const keep = Math.max(pending.startMarker.length - 1, 0);
      if (pending.buffer.length > keep) pending.buffer = pending.buffer.slice(-keep);
      return '';
    }
    const outputStart = start + pending.startMarker.length,
      end = pending.buffer.indexOf(pending.endMarker, outputStart);
    if (end === -1) return '';
    const output = pending.buffer.slice(outputStart, end).trim(),
      trailing = pending.buffer.slice(end + pending.endMarker.length);
    state.setup = undefined;
    if (pending.phase === 'probe') {
      clearTimeout(pending.timeout);
      const match = output.match(/^(\d+):(bash|zsh|other)$/);
      if (match) {
        state.shellPid = Number.parseInt(match[1]!, 10);
        state.shellKind = match[2] as WorkspaceShellKind;
        this.resolveProbe(state);
      } else this.rejectProbe(state, new Error('无法识别终端路径探测结果。'));
    } else if (output === 'ok') {
      state.hookPromptTimeout = pending.timeout;
    } else {
      clearTimeout(pending.timeout);
      this.rejectHook(state, new Error('终端提示符集成初始化失败。'));
    }
    return trailing;
  }
  private resolveProbe(state: ShellState) {
    const resolve = state.probeResolve;
    state.probePromise = undefined;
    state.probeResolve = undefined;
    state.probeReject = undefined;
    resolve?.();
  }
  private rejectProbe(state: ShellState, error: Error) {
    const reject = state.probeReject;
    state.probePromise = undefined;
    state.probeResolve = undefined;
    state.probeReject = undefined;
    reject?.(error);
  }
  private resolveHook(state: ShellState) {
    const resolve = state.hookResolve;
    if (state.hookPromptTimeout) clearTimeout(state.hookPromptTimeout);
    state.hookPromptTimeout = undefined;
    state.hookPromise = undefined;
    state.hookResolve = undefined;
    state.hookReject = undefined;
    resolve?.();
  }
  private rejectHook(state: ShellState, error: Error) {
    const reject = state.hookReject;
    if (state.hookPromptTimeout) clearTimeout(state.hookPromptTimeout);
    state.hookPromptTimeout = undefined;
    state.hookPromise = undefined;
    state.hookResolve = undefined;
    state.hookReject = undefined;
    state.integrationReady = false;
    reject?.(error);
  }
  private buildProbeCommand(start: string, end: string) {
    return (
      [
        'stty -echo 2>/dev/null;',
        'if [ -n "${BASH_VERSION-}" ]; then __nexus_shell_kind=bash; elif [ -n "${ZSH_VERSION-}" ]; then __nexus_shell_kind=zsh; else __nexus_shell_kind=other; fi;',
        `printf '\\n${encodeForPrintf(start)}%s:%s${encodeForPrintf(end)}\\n' "$$" "$__nexus_shell_kind";`,
        'stty echo 2>/dev/null;',
        "printf '\\n'",
      ].join(' ') + '\r'
    );
  }
  private buildHookCommand(kind: 'bash' | 'zsh', start: string, end: string) {
    const marker = "__nexus_prompt_marker(){ printf '\\033]777;NEXUS_PROMPT\\007'; };";
    const body =
      kind === 'bash'
        ? [
            marker,
            "if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then",
            'case " ${PROMPT_COMMAND[*]} " in',
            '*" __nexus_prompt_marker "*) ;;',
            '*) PROMPT_COMMAND+=(__nexus_prompt_marker) ;;',
            'esac;',
            'else',
            'case ";${PROMPT_COMMAND-};" in',
            '*";__nexus_prompt_marker;"*) ;;',
            '*) PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}__nexus_prompt_marker" ;;',
            'esac;',
            'fi',
          ].join(' ')
        : `autoload -Uz add-zsh-hook 2>/dev/null; ${marker} add-zsh-hook -d precmd __nexus_prompt_marker 2>/dev/null; add-zsh-hook precmd __nexus_prompt_marker`;
    return (
      [
        'stty -echo 2>/dev/null;',
        `${body};`,
        `printf '\\n${encodeForPrintf(start)}ok${encodeForPrintf(end)}\\n';`,
        'stty echo 2>/dev/null;',
        "printf '\\n'",
      ].join(' ') + '\r'
    );
  }
}
