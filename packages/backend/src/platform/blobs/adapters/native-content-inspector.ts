import { fileTypeFromBuffer } from 'file-type';
import { ContentInspectionFailure } from '../content-inspector.js';
import type { ContentInspector } from '../content-inspector.js';

// file-type's documented default detection sample; this is not a file size limit.
const DETECTION_BYTES = 4100;

/** Signature detection only. Never convert bytes or trust extensions as image evidence. */
export class NativeContentInspector implements ContentInspector {
	async use<T>(
		source: AsyncIterable<Uint8Array>,
		signal: AbortSignal,
		consume: (mediaType: string, source: AsyncIterable<Uint8Array>) => Promise<T>,
	): Promise<T> {
		const iterator = source[Symbol.asyncIterator]();
		const prefix: Uint8Array[] = [];
		let length = 0;
		let ended = false;
		let consumed = false;
		let failure: unknown = null;
		try {
			while (!ended && length < DETECTION_BYTES) {
				signal.throwIfAborted();
				const next = await iterator.next();
				ended = Boolean(next.done);
				if (!next.done) {
					prefix.push(next.value);
					length += next.value.byteLength;
				}
			}
			const sample = Buffer.alloc(Math.min(length, DETECTION_BYTES));
			let offset = 0;
			for (const chunk of prefix) {
				const part = chunk.subarray(0, sample.byteLength - offset);
				sample.set(part, offset);
				offset += part.byteLength;
				if (offset === sample.byteLength) {
					break;
				}
			}
			const detected = await fileTypeFromBuffer(sample);

			async function* replay(): AsyncIterable<Uint8Array> {
				for (const chunk of prefix) {
					signal.throwIfAborted();
					yield chunk;
				}
				while (!ended) {
					signal.throwIfAborted();
					const next = await iterator.next();
					ended = Boolean(next.done);
					if (!next.done) {
						yield next.value;
					}
				}
				signal.throwIfAborted();
				consumed = true;
			}

			const result = await consume(detected?.mime ?? 'application/octet-stream', replay());
			if (!consumed) {
				throw new ContentInspectionFailure('source_failed');
			}
			return result;
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			if (iterator.return) {
				try {
					await iterator.return();
				} catch (cleanup) {
					throw new ContentInspectionFailure('cleanup_failed', {
						cause:
							failure === null
								? cleanup
								: new AggregateError([failure, cleanup], 'Content read and close failed'),
					});
				}
			}
		}
	}
}
