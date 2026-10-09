type TerminalWrite = (data: string, consumed?: () => void) => void;

const BACKGROUND_BATCH_MS = 80;
const BACKGROUND_MAX_BATCH_BYTES = 512 * 1024;

/**
 * xterm owns asynchronous parsing; foreground output needs no outer scheduler.
 * Background sessions retain bounded batching without depending on animation frames.
 * Consumption credit is returned after parsing, including when a batch is flushed.
 */
export const createTerminalOutputWriter = (write: TerminalWrite) => {
	let chunks: string[] = [];
	let bytes = 0;
	let consumers: Array<() => void> = [];
	let timer: number | undefined;

	const clearTimer = (): void => {
		window.clearTimeout(timer);
		timer = undefined;
	};

	const takeBatch = () => {
		clearTimer();
		const batch = { data: chunks.join(''), consumers };
		chunks = [];
		bytes = 0;
		consumers = [];
		return batch;
	};

	const flush = (): void => {
		if (!chunks.length) return;
		const batch = takeBatch();
		write(batch.data, () => {
			for (const consumed of batch.consumers) consumed();
		});
	};

	return {
		enqueue(data: string, byteLength: number, background: boolean, consumed?: () => void): void {
			if (!background) {
				// Submit the old background batch first to preserve the stream's ordering.
				flush();
				write(data, consumed);
				return;
			}
			chunks.push(data);
			bytes += byteLength;
			if (consumed) consumers.push(consumed);
			if (bytes >= BACKGROUND_MAX_BATCH_BYTES) flush();
			else if (timer === undefined) timer = window.setTimeout(flush, BACKGROUND_BATCH_MS);
		},

		flush,

		drain(): Promise<void> {
			flush();
			// A parser barrier covers both the batch and writes already submitted to xterm.
			return new Promise<void>((resolve) => write('', resolve));
		},

		discard(): void {
			// Only a replaced PTY may discard queued output. Release its old flow credit.
			for (const consumed of takeBatch().consumers) consumed();
		},
	};
};
