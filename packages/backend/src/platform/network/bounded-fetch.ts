export type FetchFailureKind = 'unavailable' | 'limit_exceeded' | 'cleanup_failed';

export class FetchFailure extends Error {
	constructor(
		readonly kind: FetchFailureKind,
		options?: ErrorOptions,
	) {
		super(kind, options);
		this.name = 'FetchFailure';
	}
}

export interface BoundedFetchRequest {
	url: string;
	headers: Readonly<Record<string, string>>;
	maxBytes: number;
	signal: AbortSignal;
	redirects?: { max: number; allow(url: string): boolean };
}

export interface BoundedFetchResponse {
	status: number;
	bytes: Uint8Array;
}

export interface BoundedFetch {
	get(request: BoundedFetchRequest): Promise<BoundedFetchResponse>;
}
