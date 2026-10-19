import { streamZip } from '../../../../platform/archive/adapters/zip/zip-stream.js';
import { ZipStreamFailure, type ZipSourceEntry } from '../../../../platform/archive/archive-port.js';
import { RemoteFileFailure } from './file-types.js';
import type { FileZipEntry } from './file-task-types.js';

export async function streamFileZip(
	entries: (signal: AbortSignal) => AsyncIterable<FileZipEntry>,
	signal: AbortSignal,
	onChunk: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>,
): Promise<void> {
	try {
		await streamZip(
			async function* (abort): AsyncIterable<ZipSourceEntry> {
				for await (const entry of entries(abort)) {
					if (entry.kind === 'directory') {
						yield { kind: 'directory', name: entry.name };
					} else {
						yield {
							kind: 'file',
							name: entry.name,
							bytes: {
								async *[Symbol.asyncIterator]() {
									for await (const bytes of entry.bytes) {
										yield Uint8Array.from(bytes);
									}
								},
							},
						};
					}
				}
			},
			signal,
			async (bytes, abort) => onChunk(Uint8Array.from(bytes), abort),
		);
	} catch (cause) {
		if (!(cause instanceof ZipStreamFailure)) {
			throw cause;
		}
		if (cause.cause instanceof RemoteFileFailure) {
			throw cause.cause;
		}
		throw new RemoteFileFailure('remote_unavailable', { cause });
	}
}
