/** The connection owner proves fetch was never invoked for this request. */
export class SafeHttpRequestRefusal extends Error {
	constructor(options?: ErrorOptions) {
		super('HTTP request was not dispatched', options);
		this.name = 'SafeHttpRequestRefusal';
	}
}

export interface SafeHttpHeader {
	name: string;
	value: string;
}

/** Fixed destination and credentials are supplied by the resource owner, never by its consumer. */
export interface SafeHttpConnectionOptions {
	url: string;
	headers: readonly SafeHttpHeader[];
	privateAuthorities: readonly string[];
	maxResponseBytes: number;
	signal: AbortSignal;
}

export interface SafeHttpRequest {
	method: 'GET' | 'POST' | 'DELETE';
	headers: readonly SafeHttpHeader[];
	bodyUtf8: string | null;
}

export interface SafeHttpResponse {
	readonly status: number;
	readonly statusText: string;
	readonly headers: readonly SafeHttpHeader[];
	readonly hasBody: boolean;
	/** One pending pull; maxBytes is a transport chunk budget, not a response limit. */
	read(maxBytes: number): Promise<{ bytes: Uint8Array; eof: boolean }>;
	close(): Promise<void>;
}

export interface SafeHttpConnection {
	request(input: SafeHttpRequest): Promise<SafeHttpResponse>;
	close(): Promise<void>;
}
