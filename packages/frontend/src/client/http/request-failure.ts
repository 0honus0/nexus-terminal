export type HttpRequestFailureCode = 'request_failed' | 'protocol_failure' | 'cancelled' | 'invalid_input';

export type RequestOutcome = 'not_dispatched' | 'unknown' | 'confirmed';

export class HttpRequestFailure extends Error {
	constructor(
		readonly code: HttpRequestFailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('HTTP request failed', options);
		this.name = 'HttpRequestFailure';
	}
}
