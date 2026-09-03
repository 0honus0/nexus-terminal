import { v4 as uuidv4 } from 'uuid';
import * as pathModule from 'node:path';
import type { WorkspaceSession } from '../workspace-session';
import { executeSshCommand } from '../../../platform/execution/ssh-command-executor';
import { quotePosixShellArg } from '../../../platform/execution/posix-shell';

const encodeForPosixPrintf = (value: string): string =>
  Array.from(value)
    .map((char) => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`)
    .join('');

const SHELL_PROMPT_MARKER = '\x1b]777;NEXUS_PROMPT\x07';
export const sendSshRequestMessage = (
  state: WorkspaceSession,
  type: string,
  requestId: string,
  payload: Record<string, unknown>,
): void => {
  if (state.ws.readyState === state.ws.OPEN) {
    state.ws.send(JSON.stringify({ type, requestId, payload }));
  }
};

const parseDelimitedAbsolutePath = (output: string): string => {
  const start = output.indexOf('\0');
  const end = start >= 0 ? output.indexOf('\0', start + 1) : -1;
  if (start < 0 || end < 0) throw new Error('Remote command did not return a delimited path');
  const candidate = output.slice(start + 1, end);
  if (!candidate.startsWith('/')) throw new Error('Remote command did not return an absolute path');
  return candidate;
};

export const resolveRemoteDirectory = async (state: WorkspaceSession, requestedPath: string): Promise<string> =>
  parseDelimitedAbsolutePath(
    (
      await executeSshCommand(state.executionSession.client, {
        command: `cd -P ${quotePosixShellArg(requestedPath)} 2>/dev/null && printf '\\000%s\\000' "$PWD"`,
        timeoutMs: 5000,
      })
    ).stdout,
  );

const DELETED_CWD_SUFFIX = ' (deleted)';

export const readShellCurrentPath = async (state: WorkspaceSession): Promise<string> => {
  if (!state.shellPid) throw new Error('Shell PID is unavailable');
  const currentPath = parseDelimitedAbsolutePath(
    (
      await executeSshCommand(state.executionSession.client, {
        command: `printf '\\000'; readlink -n /proc/${state.shellPid}/cwd; nexus_status=$?; printf '\\000'; exit "$nexus_status"`,
        timeoutMs: 5000,
      })
    ).stdout,
  );

  if (!currentPath.endsWith(DELETED_CWD_SUFFIX)) return currentPath;

  // A real directory is allowed to literally end in " (deleted)". Only treat
  // the kernel suffix as special when that exact path no longer resolves.
  try {
    return await resolveRemoteDirectory(state, currentPath);
  } catch {
    // Continue with deleted-cwd recovery below.
  }

  const deletedPath = currentPath.slice(0, -DELETED_CWD_SUFFIX.length);
  let fallbackPath = pathModule.posix.dirname(deletedPath || '/');
  while (true) {
    try {
      return await resolveRemoteDirectory(state, fallbackPath);
    } catch {
      if (fallbackPath === '/') break;
      fallbackPath = pathModule.posix.dirname(fallbackPath);
    }
  }
  throw new Error('Terminal current directory was deleted and no existing parent directory could be resolved.');
};

export const clearPendingDirectoryChange = (state: WorkspaceSession): void => {
  if (state.pendingDirectoryChange) clearTimeout(state.pendingDirectoryChange.timeout);
  state.pendingDirectoryChange = undefined;
};

export async function handleShellPrompt(state: WorkspaceSession): Promise<void> {
  const pending = state.pendingDirectoryChange;
  if (!pending || !state.sshShellStream) return;

  if (!pending.executing) {
    pending.executing = true;
    state.shellAtPrompt = false;
    // The PTY echoes injected input and its Enter newline. Hide only this internal
    // command until the next prompt marker, then redraw the prompt in place.
    state.suppressOutputUntilPrompt = true;
    // The marker is emitted immediately before the shell starts reading a fresh line.
    // Ctrl-U defensively clears any stale line-editor buffer without touching a child process.
    state.sshShellStream.write(`\x15cd ${quotePosixShellArg(pending.path)}\r`);
    return;
  }

  clearPendingDirectoryChange(state);
  try {
    const currentPath = await readShellCurrentPath(state);
    if (currentPath !== pending.expectedPath) {
      throw new Error(`Shell remained in ${currentPath}`);
    }
    sendSshRequestMessage(state, 'ssh:change_directory:result', pending.requestId, { path: currentPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendSshRequestMessage(state, 'ssh:change_directory:error', pending.requestId, { error: message });
  }
}

const consumePromptMarkers = (state: WorkspaceSession, chunk: string): string => {
  const data = (state.shellControlRemainder || '') + chunk;
  state.shellControlRemainder = '';
  let visible = '';
  let cursor = 0;
  let markerIndex = data.indexOf(SHELL_PROMPT_MARKER, cursor);

  while (markerIndex !== -1) {
    if (state.suppressOutputUntilPrompt) {
      // Replace the old prompt line instead of forwarding the injected command echo
      // and the CR/LF produced by the remote terminal driver.
      visible += '\r\x1b[2K';
      state.suppressOutputUntilPrompt = false;
    } else {
      visible += data.slice(cursor, markerIndex);
    }
    state.shellAtPrompt = true;
    state.shellIntegrationReady = true;
    // The hook is not considered ready until its first real prompt marker arrives.
    // This prevents the first directory-change request from seeing a false busy state
    // when the hook setup acknowledgement and the prompt are delivered in separate SSH chunks.
    if (state.shellHookPromise) resolveShellHook(state);
    void handleShellPrompt(state);
    cursor = markerIndex + SHELL_PROMPT_MARKER.length;
    markerIndex = data.indexOf(SHELL_PROMPT_MARKER, cursor);
  }

  const tail = data.slice(cursor);
  let partialLength = 0;
  const maxPartial = Math.min(tail.length, SHELL_PROMPT_MARKER.length - 1);
  for (let length = maxPartial; length > 0; length--) {
    if (SHELL_PROMPT_MARKER.startsWith(tail.slice(-length))) {
      partialLength = length;
      break;
    }
  }

  const completeTail = partialLength > 0 ? tail.slice(0, -partialLength) : tail;
  if (!state.suppressOutputUntilPrompt) {
    visible += completeTail;
  }
  if (partialLength > 0) {
    state.shellControlRemainder = tail.slice(-partialLength);
  }
  return visible;
};

const buildPromptHookBody = (shellKind: 'bash' | 'zsh'): string => {
  const markerFunction = "__nexus_prompt_marker(){ printf '\\033]777;NEXUS_PROMPT\\007'; };";
  if (shellKind === 'bash') {
    return [
      markerFunction,
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
    ].join(' ');
  }
  return `autoload -Uz add-zsh-hook 2>/dev/null; ${markerFunction} add-zsh-hook -d precmd __nexus_prompt_marker 2>/dev/null; add-zsh-hook precmd __nexus_prompt_marker`;
};

const buildPromptHookCommand = (shellKind: 'bash' | 'zsh', startMarker: string, endMarker: string): string => {
  const encodedStart = encodeForPosixPrintf(startMarker);
  const encodedEnd = encodeForPosixPrintf(endMarker);
  return (
    [
      'stty -echo 2>/dev/null;',
      `${buildPromptHookBody(shellKind)};`,
      `printf '\\n${encodedStart}ok${encodedEnd}\\n';`,
      'stty echo 2>/dev/null;',
      "printf '\\n'",
    ].join(' ') + '\r'
  );
};

const resolveShellProbe = (state: WorkspaceSession): void => {
  const resolve = state.shellProbeResolve;
  state.shellProbePromise = undefined;
  state.shellProbeResolve = undefined;
  state.shellProbeReject = undefined;
  resolve?.();
};

const rejectShellProbe = (state: WorkspaceSession, error: Error): void => {
  const reject = state.shellProbeReject;
  state.shellProbePromise = undefined;
  state.shellProbeResolve = undefined;
  state.shellProbeReject = undefined;
  reject?.(error);
};

const clearShellHookPromptTimeout = (state: WorkspaceSession): void => {
  if (state.shellHookPromptTimeout) {
    clearTimeout(state.shellHookPromptTimeout);
    state.shellHookPromptTimeout = undefined;
  }
};

const resolveShellHook = (state: WorkspaceSession): void => {
  const resolve = state.shellHookResolve;
  clearShellHookPromptTimeout(state);
  state.shellHookPromise = undefined;
  state.shellHookResolve = undefined;
  state.shellHookReject = undefined;
  resolve?.();
};

const rejectShellHook = (state: WorkspaceSession, error: Error): void => {
  const reject = state.shellHookReject;
  clearShellHookPromptTimeout(state);
  state.shellHookPromise = undefined;
  state.shellHookResolve = undefined;
  state.shellHookReject = undefined;
  state.shellIntegrationReady = false;
  reject?.(error);
};

const installPromptHook = (state: WorkspaceSession): Promise<void> => {
  if (state.shellIntegrationReady) return Promise.resolve();
  if (state.shellHookPromise) return state.shellHookPromise;
  if (!state.sshShellStream) return Promise.reject(new Error('SSH Shell 尚未就绪。'));
  if (state.shellKind !== 'bash' && state.shellKind !== 'zsh') {
    return Promise.reject(new Error('当前 Shell 不支持安全目录队列；为避免影响前台程序，未发送 cd。'));
  }

  const hookPromise = new Promise<void>((resolve, reject) => {
    state.shellHookResolve = resolve;
    state.shellHookReject = reject;
  });
  state.shellHookPromise = hookPromise;

  const token = uuidv4().replace(/-/g, '');
  const startMarker = `__NEXUS_HOOK_BEGIN_${token}__`;
  const endMarker = `__NEXUS_HOOK_END_${token}__`;
  const timeout = setTimeout(() => {
    state.shellSetup = undefined;
    rejectShellHook(state, new Error('终端提示符集成初始化超时。'));
  }, 5000);

  state.shellSetup = { phase: 'hook', startMarker, endMarker, buffer: '', timeout };
  try {
    state.sshShellStream.write(buildPromptHookCommand(state.shellKind, startMarker, endMarker));
  } catch (error) {
    clearTimeout(timeout);
    state.shellSetup = undefined;
    rejectShellHook(state, error instanceof Error ? error : new Error(String(error)));
  }

  return hookPromise;
};

const consumeShellSetupOutput = (state: WorkspaceSession, chunk: string): string => {
  const pending = state.shellSetup;
  if (!pending) return chunk;

  pending.buffer += chunk;
  const startIndex = pending.buffer.indexOf(pending.startMarker);
  if (startIndex === -1) {
    const keep = Math.max(pending.startMarker.length - 1, 0);
    if (pending.buffer.length > keep) pending.buffer = pending.buffer.slice(-keep);
    return '';
  }
  const outputStart = startIndex + pending.startMarker.length;
  const endIndex = pending.buffer.indexOf(pending.endMarker, outputStart);
  if (endIndex === -1) return '';

  const output = pending.buffer.slice(outputStart, endIndex).trim();
  const trailingOutput = pending.buffer.slice(endIndex + pending.endMarker.length);
  state.shellSetup = undefined;

  if (pending.phase === 'probe') {
    clearTimeout(pending.timeout);
    const match = output.match(/^(\d+):(bash|zsh|other)$/);
    if (match) {
      state.shellPid = Number.parseInt(match[1], 10);
      state.shellKind = match[2] as 'bash' | 'zsh' | 'other';
      resolveShellProbe(state);
    } else {
      rejectShellProbe(state, new Error('无法识别终端路径探测结果。'));
    }
  } else if (pending.phase === 'hook') {
    if (output === 'ok') {
      // Keep the original setup timeout alive while waiting for the first prompt
      // emitted by the newly installed hook. Only that marker proves the shell is
      // actually ready to accept a queued directory change.
      state.shellHookPromptTimeout = pending.timeout;
    } else {
      clearTimeout(pending.timeout);
      rejectShellHook(state, new Error('终端提示符集成初始化失败。'));
    }
  }
  return trailingOutput;
};

export const filterSshShellOutput = (state: WorkspaceSession, chunk: string): string => {
  const setupFiltered = consumeShellSetupOutput(state, chunk);
  return consumePromptMarkers(state, setupFiltered);
};

const buildShellProbeCommand = (startMarker: string, endMarker: string): string => {
  const encodedStart = encodeForPosixPrintf(startMarker);
  const encodedEnd = encodeForPosixPrintf(endMarker);
  return (
    [
      'stty -echo 2>/dev/null;',
      'if [ -n "${BASH_VERSION-}" ]; then __nexus_shell_kind=bash; elif [ -n "${ZSH_VERSION-}" ]; then __nexus_shell_kind=zsh; else __nexus_shell_kind=other; fi;',
      `printf '\\n${encodedStart}%s:%s${encodedEnd}\\n' "$$" "$__nexus_shell_kind";`,
      'stty echo 2>/dev/null;',
      "printf '\\n'",
    ].join(' ') + '\r'
  );
};

export const ensureShellProbe = (state: WorkspaceSession): Promise<void> => {
  if (state.shellPid) return Promise.resolve();
  if (state.shellProbePromise) return state.shellProbePromise;
  if (!state.sshShellStream) return Promise.reject(new Error('SSH Shell 尚未就绪。'));

  const probePromise = new Promise<void>((resolve, reject) => {
    state.shellProbeResolve = resolve;
    state.shellProbeReject = reject;
  });
  state.shellProbePromise = probePromise;

  const token = uuidv4().replace(/-/g, '');
  const startMarker = `__NEXUS_SHELL_BEGIN_${token}__`;
  const endMarker = `__NEXUS_SHELL_END_${token}__`;
  const timeout = setTimeout(() => {
    state.shellSetup = undefined;
    rejectShellProbe(state, new Error('终端路径探测超时。'));
  }, 5000);

  state.shellIntegrationReady = false;
  state.shellSetup = { phase: 'probe', startMarker, endMarker, buffer: '', timeout };
  try {
    state.sshShellStream.write(buildShellProbeCommand(startMarker, endMarker));
  } catch (error) {
    clearTimeout(timeout);
    state.shellSetup = undefined;
    rejectShellProbe(state, error instanceof Error ? error : new Error(String(error)));
  }

  return probePromise;
};

export const ensureShellPromptHook = async (state: WorkspaceSession): Promise<void> => {
  await ensureShellProbe(state);
  await installPromptHook(state);
};
