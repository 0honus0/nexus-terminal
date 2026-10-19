import { finished } from 'node:stream/promises';
import { TerminalCleanupFailure } from '../terminal-errors.js';
import type { TerminalLogRenderer, TerminalLogTextSource } from '../suspended-log-port.js';
import { Readable } from 'node:stream';
import headless, { type Terminal } from '@xterm/headless';
import type { SuspendedViewport } from '../suspended-checkpoint-port.js';

const MAX_EXPORT_SCROLLBACK = 100_000;

function terminalText(terminal: Terminal): string {
	const buffer = terminal.buffer.active;
	const lines: string[] = [];
	let current = '';
	for (let index = 0; index < buffer.length; index += 1) {
		const line = buffer.getLine(index);
		if (!line) {
			continue;
		}
		const value = line.translateToString(true);
		if (line.isWrapped) {
			current += value;
		} else {
			if (index > 0) {
				lines.push(current.trimEnd());
			}
			current = value;
		}
	}
	lines.push(current.trimEnd());
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start]?.trim() === '') {
		start++;
	}
	while (end > start && lines[end - 1]?.trim() === '') {
		end--;
	}
	return start < end ? lines.slice(start, end).join('\n') + '\n' : '';
}

/** Headless VT rendering, never regular-expression stripping of escape codes. */
async function renderSuspendedLog(
	source: Readable,
	viewport: SuspendedViewport,
	signal?: AbortSignal,
): Promise<Readable> {
	const terminal = new headless.Terminal({
		cols: viewport.columns,
		rows: viewport.rows,
		scrollback: MAX_EXPORT_SCROLLBACK,
		allowProposedApi: true,
	});

	const abort = () => source.destroy(new Error('Terminal export cancelled', { cause: signal?.reason }));

	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) {
		abort();
	}
	let totalBytes = 0;
	let result: Readable | null = null;
	let failure: unknown = null;
	try {
		for await (const chunk of source) {
			signal?.throwIfAborted();
			const bytes = Buffer.isBuffer(chunk)
				? chunk
				: chunk instanceof Uint8Array
					? Buffer.from(chunk)
					: Buffer.from(String(chunk));
			totalBytes += bytes.byteLength;
			if (totalBytes > 100 * 1024 * 1024) {
				throw new RangeError('Terminal export exceeds byte budget');
			}
			if (bytes.byteLength) {
				await new Promise<void>((resolve) => terminal.write(bytes, resolve));
			}
		}
		signal?.throwIfAborted();
		result = Readable.from([Buffer.from(terminalText(terminal), 'utf8')]);
	} catch (error) {
		failure = error;
	}
	signal?.removeEventListener('abort', abort);
	const cleanupErrors: unknown[] = [];
	try {
		source.destroy();
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await finished(source, { cleanup: true });
	} catch (error) {
		const premature = error instanceof Error && 'code' in error && error.code === 'ERR_STREAM_PREMATURE_CLOSE';
		if (!premature && error !== failure) {
			cleanupErrors.push(error);
		}
	}
	try {
		terminal.dispose();
	} catch (error) {
		cleanupErrors.push(error);
	}
	if (cleanupErrors.length) {
		throw new TerminalCleanupFailure(failure === null ? cleanupErrors : [failure, ...cleanupErrors]);
	}
	if (failure !== null) {
		throw failure;
	}
	if (result === null) {
		throw new Error('Terminal renderer produced no text');
	}
	return result;
}

async function releaseStream(stream: Readable, primary?: unknown): Promise<void> {
	stream.destroy();
	try {
		await finished(stream, { cleanup: true });
	} catch (error) {
		if (
			error === primary ||
			(error instanceof Error && 'code' in error && error.code === 'ERR_STREAM_PREMATURE_CLOSE')
		) {
			return;
		}
		throw new TerminalCleanupFailure(primary === undefined ? [error] : [primary, error]);
	}
}

export class HeadlessTerminalLogRenderer implements TerminalLogRenderer {
	async render(source: Readable, viewport: SuspendedViewport, signal?: AbortSignal): Promise<TerminalLogTextSource> {
		let rendered: Readable;
		try {
			rendered = await renderSuspendedLog(source, viewport, signal);
		} catch (error) {
			await releaseStream(source, error);
			throw error;
		}
		return {
			bytes: (async function* () {
				for await (const bytes of rendered) {
					if (!(bytes instanceof Uint8Array)) {
						throw new Error('Terminal renderer returned non-byte output');
					}
					for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
						signal?.throwIfAborted();
						yield Uint8Array.from(bytes.subarray(offset, offset + 64 * 1024));
					}
				}
			})(),

			release: () => releaseStream(rendered),
		};
	}
}
