import type { Terminal } from '@xterm/xterm';

/**
 * DEC private modes that change how the terminal encodes keyboard, mouse and scroll input.
 *
 * `@xterm/addon-serialize` only restores a subset of DEC private modes (see its internal
 * `_serializeModes`); the extended mouse and scroll encodings below are never serialized, so every
 * snapshot/restore silently drops them. An application that keeps running across a Workspace
 * suspend/resume or pane remount (opencode, vim, htop, ...) never re-emits those setup sequences, so
 * the restored terminal then encodes input differently than the remote application expects: mouse
 * wheel scroll and focus events stop working even though the TUI is still alive.
 *
 * The backend suspend checkpoint keeps the same list in
 * `packages/backend/src/infrastructure/ssh-suspend/terminal-input-mode-tracker.ts`; both sides must
 * stay in sync because each serializes the terminal independently.
 */
export const TERMINAL_INPUT_ENCODING_MODES: readonly number[] = [1005, 1006, 1007, 1015, 1016];

export interface TerminalInputModeTracker {
  /** ANSI suffix that re-enables every tracked mode that is currently active. */
  restoreSuffix(): string;
  dispose(): void;
}

/**
 * Tracks the DEC private modes a live terminal has enabled so a serialized snapshot can restore the
 * input encodings that `SerializeAddon` omits. Only public xterm parser APIs are used.
 */
export function trackTerminalInputModes(terminal: Terminal): TerminalInputModeTracker {
  const allowed = new Set(TERMINAL_INPUT_ENCODING_MODES);
  const enabled = new Set<number>();
  const apply =
    (final: 'h' | 'l') =>
    (params: (number | number[])[]): boolean => {
      for (const param of params) {
        const mode = Array.isArray(param) ? param[0] : param;
        if (typeof mode !== 'number' || !allowed.has(mode)) continue;
        if (final === 'h') enabled.add(mode);
        else enabled.delete(mode);
      }
      return false;
    };
  const disposables = [
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, apply('h')),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, apply('l')),
  ];
  return {
    restoreSuffix: () =>
      [...enabled]
        .sort((left, right) => left - right)
        .map((mode) => `\u001b[?${mode}h`)
        .join(''),
    dispose: () => {
      for (const disposable of disposables) disposable.dispose();
    },
  };
}
