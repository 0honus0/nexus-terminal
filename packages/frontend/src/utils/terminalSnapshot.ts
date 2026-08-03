import { SerializeAddon } from '@xterm/addon-serialize';
import type { Terminal } from '@xterm/xterm';

const DEFAULT_MAX_SNAPSHOT_BYTES = 1024 * 1024 - 4096;
const DEFAULT_SCROLLBACK_LINES = 1000;
const snapshotEncoder = new TextEncoder();

const snapshotSize = (snapshot: string): number => snapshotEncoder.encode(snapshot).length;

/**
 * Serialize terminal output as ANSI so colors, text attributes and cursor state survive a remount
 * or SSH suspend/resume. If necessary, reduce older scrollback before dropping recent rows.
 */
export const serializeTerminalSnapshot = (
  terminal: Terminal,
  maxBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
): string | undefined => {
  const addon = new SerializeAddon();
  terminal.loadAddon(addon);

  try {
    let scrollback = Math.min(DEFAULT_SCROLLBACK_LINES, Math.max(0, terminal.buffer.active.length - terminal.rows));
    let snapshot = addon.serialize({ scrollback });

    while (snapshotSize(snapshot) > maxBytes && scrollback > 0) {
      scrollback = Math.floor(scrollback / 2);
      snapshot = addon.serialize({ scrollback });
    }

    if (snapshotSize(snapshot) <= maxBytes) return snapshot || undefined;

    const bufferLength = terminal.buffer.active.length;
    let rowCount = Math.min(terminal.rows, bufferLength);
    while (rowCount > 1) {
      const start = Math.max(0, bufferLength - rowCount);
      snapshot = addon.serialize({ range: { start, end: bufferLength - 1 } });
      if (snapshotSize(snapshot) <= maxBytes) return snapshot || undefined;
      rowCount = Math.floor(rowCount / 2);
    }

    return undefined;
  } finally {
    addon.dispose();
  }
};
