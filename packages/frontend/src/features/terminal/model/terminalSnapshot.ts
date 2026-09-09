import type { SerializeAddon } from '@xterm/addon-serialize';
import type { Terminal } from '@xterm/xterm';

const DEFAULT_MAX_SNAPSHOT_BYTES = 1024 * 1024 - 4096;
const DEFAULT_SCROLLBACK_LINES = 1000;
const encoder = new TextEncoder();

const byteLength = (value: string): number => encoder.encode(value).byteLength;

const plainTextFallback = (terminal: Terminal, maxBytes: number): string => {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  let bytes = 0;

  for (let index = buffer.length - 1; index >= 0 && lines.length < DEFAULT_SCROLLBACK_LINES; index -= 1) {
    const line = buffer.getLine(index)?.translateToString(true) ?? '';
    const lineBytes = byteLength(line) + 2;
    if (bytes + lineBytes > maxBytes && lines.length > 0) break;
    lines.push(line);
    bytes += lineBytes;
  }

  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  return lines.length ? `${lines.reverse().join('\r\n')}\r\n` : '';
};

/**
 * Serializes the newest useful terminal state into a bounded ANSI snapshot.
 * Older scrollback is reduced first so suspend/remount payloads cannot grow
 * without bound. Only public xterm APIs are used.
 */
export function serializeTerminalSnapshot(
  terminal: Terminal,
  addon: SerializeAddon,
  maxBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
): string {
  try {
    let scrollback = Math.min(DEFAULT_SCROLLBACK_LINES, Math.max(0, terminal.buffer.active.length - terminal.rows));
    let snapshot = addon.serialize({ scrollback });

    while (byteLength(snapshot) > maxBytes && scrollback > 0) {
      scrollback = Math.floor(scrollback / 2);
      snapshot = addon.serialize({ scrollback });
    }
    if (byteLength(snapshot) <= maxBytes) return snapshot;

    const bufferLength = terminal.buffer.active.length;
    let rowCount = Math.min(terminal.rows, bufferLength);
    while (rowCount > 1) {
      const start = Math.max(0, bufferLength - rowCount);
      snapshot = addon.serialize({ range: { start, end: bufferLength - 1 } });
      if (byteLength(snapshot) <= maxBytes) return snapshot;
      rowCount = Math.floor(rowCount / 2);
    }
    return '';
  } catch {
    try {
      return plainTextFallback(terminal, maxBytes);
    } catch {
      return '';
    }
  }
}
