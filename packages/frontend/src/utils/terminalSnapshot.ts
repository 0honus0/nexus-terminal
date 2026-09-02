import { SerializeAddon } from '@xterm/addon-serialize';
import type { Terminal } from '@xterm/xterm';

const DEFAULT_MAX_SNAPSHOT_BYTES = 1024 * 1024 - 4096;
const DEFAULT_SCROLLBACK_LINES = 1000;
const snapshotEncoder = new TextEncoder();
const serializeAddons = new WeakMap<Terminal, SerializeAddon>();

const snapshotSize = (snapshot: string): number => snapshotEncoder.encode(snapshot).length;

const getSerializeAddon = (terminal: Terminal): SerializeAddon => {
  const loadedAddon = serializeAddons.get(terminal);
  if (loadedAddon) return loadedAddon;

  const addon = new SerializeAddon();
  terminal.loadAddon(addon);
  serializeAddons.set(terminal, addon);
  return addon;
};

const serializePlainTextFallback = (terminal: Terminal, maxBytes: number): string | undefined => {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  let totalBytes = 0;

  for (let index = buffer.length - 1; index >= 0 && lines.length < DEFAULT_SCROLLBACK_LINES; index -= 1) {
    const line = buffer.getLine(index)?.translateToString(true) ?? '';
    const lineBytes = snapshotEncoder.encode(line).length + 2;
    if (totalBytes + lineBytes > maxBytes && lines.length > 0) break;
    lines.push(line);
    totalBytes += lineBytes;
  }

  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  if (lines.length === 0) return undefined;
  return `${lines.reverse().join('\r\n')}\r\n`;
};

/**
 * Serialize terminal output as ANSI so colors, text attributes and cursor state survive a remount
 * or SSH suspend/resume. If necessary, reduce older scrollback before dropping recent rows.
 */
export const serializeTerminalSnapshot = (
  terminal: Terminal,
  maxBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
): string | undefined => {
  try {
    // Addons are owned by xterm. Reuse one addon per terminal and let terminal.dispose()
    // release it; manually disposing a temporary addon can corrupt xterm's addon list.
    const addon = getSerializeAddon(terminal);
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
  } catch (error) {
    console.warn('[TerminalSnapshot] ANSI snapshot failed; falling back to plain text:', error);
    try {
      return serializePlainTextFallback(terminal, maxBytes);
    } catch (fallbackError) {
      console.warn('[TerminalSnapshot] Plain-text snapshot also failed:', fallbackError);
      return undefined;
    }
  }
};
