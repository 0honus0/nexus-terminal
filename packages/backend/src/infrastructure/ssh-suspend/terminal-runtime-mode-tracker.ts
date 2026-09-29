import type { Terminal } from '@xterm/headless';

type MouseEncoding = 'default' | 'sgr' | 'sgr-pixels';

export interface TerminalRuntimeModeTracker {
  restoreSuffix(): string;
  dispose(): void;
}

/** Tracks xterm runtime modes that SerializeAddon 0.14 does not include in snapshots. */
export function trackTerminalRuntimeModes(terminal: Terminal): TerminalRuntimeModeTracker {
  let mouseEncoding: MouseEncoding = 'default';
  const apply =
    (enabled: boolean) =>
    (params: (number | number[])[]): boolean => {
      for (const param of params) {
        const mode = Array.isArray(param) ? param[0] : param;
        if (mode === 1006) mouseEncoding = enabled ? 'sgr' : 'default';
        else if (mode === 1016) mouseEncoding = enabled ? 'sgr-pixels' : 'default';
      }
      return false;
    };
  const disposables = [
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, apply(true)),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, apply(false)),
  ];
  return {
    restoreSuffix() {
      let suffix = '';
      if (mouseEncoding === 'sgr') suffix += '\u001b[?1006h';
      else if (mouseEncoding === 'sgr-pixels') suffix += '\u001b[?1016h';
      return suffix;
    },
    dispose() {
      for (const disposable of disposables) disposable.dispose();
    },
  };
}
