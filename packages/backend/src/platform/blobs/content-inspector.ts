export interface ContentInspector {
	use<T>(
		source: AsyncIterable<Uint8Array>,
		signal: AbortSignal,
		consume: (mediaType: string, source: AsyncIterable<Uint8Array>) => Promise<T>,
	): Promise<T>;
}

export class ContentInspectionFailure extends Error {
	constructor(
		readonly kind: 'source_failed' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super('Content inspection: ' + kind, options);
	}
}
