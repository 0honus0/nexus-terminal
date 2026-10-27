export interface BlobFacts {
	bytes: number;
	sha256: string;
}

export interface BlobRange {
	start: number;
	endInclusive: number;
}

export class BlobFailure extends Error {
	constructor(
		readonly kind:
			'not_found' | 'conflict' | 'limit_exceeded' | 'io_unknown' | 'cleanup_failed' | 'unavailable' | 'aborted',
		options?: ErrorOptions,
	) {
		super('Blob: ' + kind, options);
	}
}

/** Opaque keys, bounded byte streams and actual filesystem facts. No application policy. */
export interface BlobStore {
	freeBytes(): Promise<number>;
	/** Exact size of the published object, including zero-length objects. */
	size(key: string): Promise<number>;
	write(
		key: string,
		source: AsyncIterable<Uint8Array>,
		expectedBytes: number,
		signal: AbortSignal,
	): Promise<BlobFacts>;
	read(key: string, range: BlobRange, signal: AbortSignal): AsyncIterable<Uint8Array>;
	remove(key: string): Promise<void>;
}
