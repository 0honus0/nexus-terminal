import type { Terminal } from '@xterm/headless';

/**
 * DEC private modes that change how the terminal encodes keyboard, mouse and scroll input.
 *
 * `@xterm/addon-serialize` only restores a subset of DEC private modes (see its internal
 * `_serializeModes`); the extended mouse and scroll encodings below are never serialized, so every
 * serialized checkpoint silently drops them. A TUI that keeps running across a suspend/resume never
 * re-emits those setup sequences, leaving the restored terminal encoding input differently than the
 * remote application expects: mouse wheel scroll and focus events stop working.
 *
 * The frontend terminal keeps the same list in
 * `packages/frontend/src/features/terminal/model/terminalInputModes.ts`; both sides must stay in
 * sync because each serializes the terminal independently.
 */
export const TERMINAL_INPUT_ENCODING_MODES: readonly number[] = [1005, 1006, 1007, 1015, 1016];

export interface TerminalInputModeTracker {
  /** ANSI suffix that re-enables every tracked mode that is currently active. */
  restoreSuffix(): string;
  dispose(): void;
}

/**
 * Tracks the DEC private modes a checkpoint terminal has enabled so its serialized snapshot can
 * restore the input encodings that `SerializeAddon` omits. Only public xterm parser APIs are used.
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
