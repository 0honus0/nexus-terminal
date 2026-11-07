import { MODEL_TEXT_BATCH_BYTES, ModelNetworkFailure } from './model-port.js';
import type { ModelStreamEvent } from './model-port.js';

type ReadResult =
	{ kind: 'event'; value: IteratorResult<ModelStreamEvent> } | { kind: 'error'; error: unknown; cancelled: boolean };

/** Coalesce text within the existing delivery cadence and frame budget; keep control events ordered. */
export async function* modelTextBatches(
	input: AsyncIterable<ModelStreamEvent>,
	stop: () => void,
	signal: AbortSignal,
): AsyncIterable<ModelStreamEvent> {
	const iterator = input[Symbol.asyncIterator]();
	const reader: { pending: Promise<ReadResult> | null; deferred: unknown } = { pending: null, deferred: null };
	let primary: unknown = null;
	let stopping = false;

	const read = (): Promise<ReadResult> => {
		reader.pending = Promise.resolve()
			.then(() => iterator.next())
			.then(
				(value): ReadResult => ({ kind: 'event', value }),
				(error: unknown): ReadResult => ({
					kind: 'error',
					error,
					cancelled:
						(stopping || signal.aborted) &&
						error instanceof ModelNetworkFailure &&
						error.kind === 'timeout',
				}),
			);
		return reader.pending;
	};

	try {
		let current = await read();
		reader.pending = null;
		for (;;) {
			if (current.kind === 'error') {
				reader.deferred = null;
				throw current.error;
			}
			if (current.value.done) {
				return;
			}
			if (current.value.value.type !== 'text_delta') {
				yield current.value.value;
				current = await read();
				reader.pending = null;
				continue;
			}
			let text = current.value.value.text;
			let bytes = Buffer.byteLength(text);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const due = new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), 16);
			});
			try {
				for (;;) {
					const nextRead = read();
					const next = bytes >= MODEL_TEXT_BATCH_BYTES ? null : await Promise.race([nextRead, due]);
					if (next === null) {
						yield { type: 'text_delta', text };
						current = await nextRead;
						reader.pending = null;
						break;
					}
					reader.pending = null;
					if (
						next.kind === 'error' ||
						next.value.done ||
						next.value.value.type !== 'text_delta' ||
						bytes + Buffer.byteLength(next.value.value.text) > MODEL_TEXT_BATCH_BYTES
					) {
						if (next.kind === 'error') {
							reader.deferred = next.error;
						}
						// Persist the received prefix before surfacing a stream failure or control event.
						yield { type: 'text_delta', text };
						current = next;
						break;
					}
					text += next.value.value.text;
					bytes += Buffer.byteLength(next.value.value.text);
				}
			} finally {
				clearTimeout(timer);
			}
		}
	} catch (error) {
		primary = error;
		throw error;
	} finally {
		// Abort the real producer before awaiting a prefetched next/return. Waiting alone cannot stop it.
		stopping = true;
		stop();
		const late = reader.pending === null ? null : await reader.pending;
		const failures: unknown[] = [];
		let cleanupFailed = reader.deferred instanceof ModelNetworkFailure && reader.deferred.kind === 'cleanup_failed';
		if (reader.deferred !== null) {
			failures.push(reader.deferred);
		}
		if (late?.kind === 'error' && !late.cancelled && !failures.includes(late.error)) {
			failures.push(late.error);
			cleanupFailed ||= late.error instanceof ModelNetworkFailure && late.error.kind === 'cleanup_failed';
		}
		try {
			await iterator.return?.();
		} catch (error) {
			// The producer may report our stop as a request timeout after successful cleanup.
			// Its explicit cleanup_failed category (and all other late failures) still propagates.
			if (!(error instanceof ModelNetworkFailure && error.kind === 'timeout')) {
				cleanupFailed = true;
				if (!failures.includes(error)) {
					failures.push(error);
				}
			}
		}
		if (failures.length && primary !== null && !failures.includes(primary)) {
			failures.unshift(primary);
		}
		if (cleanupFailed) {
			throw new ModelNetworkFailure('cleanup_failed', undefined, {
				cause: new AggregateError(failures, 'Model stream cleanup failed'),
			});
		}
		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Model prefetch and stream cleanup failed');
		}
	}
}
