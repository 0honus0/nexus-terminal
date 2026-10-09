import { Readable } from 'node:stream';
import { Terminal } from '@xterm/headless';
import type { SuspendedTerminalLogExporter } from '../../modules/ssh-suspend/suspended-terminal-log-export.port';
import type { SuspendedTerminalViewport } from '../../modules/ssh-suspend/suspended-terminal-checkpoint.port';

const MAX_EXPORT_SCROLLBACK_LINES = 100_000;

const validViewport = (viewport: SuspendedTerminalViewport): SuspendedTerminalViewport => ({
	columns: Math.max(2, Math.min(1000, Math.floor(viewport.columns))),
	rows: Math.max(1, Math.min(500, Math.floor(viewport.rows))),
});

const writeTerminal = (terminal: Terminal, data: Uint8Array): Promise<void> =>
	new Promise((resolve) => terminal.write(data, resolve));

const terminalText = (terminal: Terminal): string => {
	const buffer = terminal.buffer.active;
	const lines: string[] = [];
	let current = '';

	for (let index = 0; index < buffer.length; index += 1) {
		const line = buffer.getLine(index);
		if (!line) continue;
		const text = line.translateToString(true);
		if (line.isWrapped) current += text;
		else {
			if (index > 0) lines.push(current.replace(/\s+$/u, ''));
			current = text;
		}
	}
	lines.push(current.replace(/\s+$/u, ''));

	while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
	while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop();
	return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};

/** Renders retained PTY bytes into readable text without exposing ANSI/VT control sequences. */
export class XtermSuspendedTerminalLogExportAdapter implements SuspendedTerminalLogExporter {
	async render(source: Readable, viewport: SuspendedTerminalViewport): Promise<Readable> {
		const normalized = validViewport(viewport);
		const terminal = new Terminal({
			cols: normalized.columns,
			rows: normalized.rows,
			scrollback: MAX_EXPORT_SCROLLBACK_LINES,
			allowProposedApi: true,
		});
		try {
			for await (const chunk of source) {
				const bytes = Buffer.isBuffer(chunk)
					? chunk
					: chunk instanceof Uint8Array
						? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
						: Buffer.from(String(chunk));
				if (bytes.byteLength > 0) await writeTerminal(terminal, bytes);
			}
			return Readable.from([terminalText(terminal)]);
		} finally {
			terminal.dispose();
		}
	}
}
