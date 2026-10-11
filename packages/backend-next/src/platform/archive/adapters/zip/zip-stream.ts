import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import { ZipStreamFailure, type ZipSourceEntry } from '../../archive-port.js';

/** Own producer and readers until they settle, including consumer rejection. */
export async function streamZip(
	entries: (signal: AbortSignal) => AsyncIterable<ZipSourceEntry>,
	signal: AbortSignal,
	onChunk: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>,
): Promise<void> {
	const controller = new AbortController();
	const archive = new ZipArchive({ zlib: { level: 6 } });
	let reader: Readable | null = null;
	let stopped = false;
	const failures = new Set<unknown>();

	const stop = () => {
		if (stopped) {
			return;
		}
		stopped = true;
		for (const cleanup of [
			() => controller.abort(),
			() => reader?.destroy(),
			() => archive.abort(),
			() => archive.destroy(),
		]) {
			try {
				cleanup();
			} catch (cause) {
				failures.add(cause);
			}
		}
	};

	signal.addEventListener('abort', stop, { once: true });
	// Observe errors even if the consumer rejects before starting iteration.
	archive.on('error', (cause: unknown) => {
		failures.add(cause);
		stop();
	});
	const producer = Promise.resolve().then(async () => {
		for await (const entry of entries(controller.signal)) {
			controller.signal.throwIfAborted();
			if (entry.kind === 'directory') {
				archive.append(Buffer.alloc(0), { name: entry.name + '/' });
				continue;
			}
			reader = Readable.from(entry.bytes);
			const completion = finished(reader, { cleanup: true });
			try {
				archive.append(reader, { name: entry.name });
				await completion;
			} catch (cause) {
				failures.add(cause);
				stop();
				// append may reject synchronously, before completion was awaited.
				// Settle the destroyed reader as well as the producer before returning.
				await completion.catch((failure: unknown) => failures.add(failure));
				throw cause;
			} finally {
				reader = null;
			}
		}
		controller.signal.throwIfAborted();
		await archive.finalize();
	});
	void producer.catch((cause: unknown) => {
		failures.add(cause);
		try {
			archive.destroy(new ZipStreamFailure({ cause }));
		} catch (cleanup) {
			failures.add(cleanup);
			stop();
		}
	});
	try {
		if (signal.aborted) {
			stop();
		}
		for await (const bytes of archive) {
			controller.signal.throwIfAborted();
			if (!(bytes instanceof Uint8Array)) {
				throw new ZipStreamFailure();
			}
			await onChunk(Uint8Array.from(bytes), controller.signal);
		}
		await producer;
	} catch (cause) {
		failures.add(cause);
	} finally {
		stop();
		signal.removeEventListener('abort', stop);
		const result = await Promise.allSettled([producer]);
		if (result[0]?.status === 'rejected') {
			failures.add(result[0].reason);
		}
	}
	if (failures.size > 0) {
		const cause = failures.size === 1 ? [...failures][0] : new AggregateError(failures, 'ZIP stream failed');
		throw new ZipStreamFailure({ cause });
	}
}
