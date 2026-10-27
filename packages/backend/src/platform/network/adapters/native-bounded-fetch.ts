import { randomUUID } from 'node:crypto';
import type { Logger } from '../../logging/logger.js';
import { logDiagnostic } from '../../logging/diagnostic-log.js';
import {
	FetchFailure,
	type BoundedFetch,
	type BoundedFetchRequest,
	type BoundedFetchResponse,
} from '../bounded-fetch.js';

async function body(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!response.body) {
		throw new FetchFailure('unavailable');
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	const failures: unknown[] = [];
	const cleanupFailures: unknown[] = [];
	try {
		const claimed = response.headers.get('content-length');
		if (claimed !== null && (!/^(0|[1-9]\d*)$/u.test(claimed) || Number(claimed) > maxBytes)) {
			throw new FetchFailure('limit_exceeded');
		}
		for (;;) {
			const part = await reader.read();
			if (part.done) {
				break;
			}
			size += part.value.byteLength;
			if (size > maxBytes) {
				throw new FetchFailure('limit_exceeded');
			}
			chunks.push(part.value);
		}
	} catch (cause) {
		failures.push(cause);
		try {
			await reader.cancel();
		} catch (cleanup) {
			// An errored ReadableStream rejects cancel with its original read failure.
			if (cleanup !== cause) {
				cleanupFailures.push(cleanup);
			}
		}
	}
	try {
		reader.releaseLock();
	} catch (cleanup) {
		cleanupFailures.push(cleanup);
	}
	if (cleanupFailures.length) {
		throw new FetchFailure('cleanup_failed', {
			cause: new AggregateError([...failures, ...cleanupFailures], 'Fetch read or release failed'),
		});
	}
	if (failures.length) {
		throw failures[0];
	}
	return Uint8Array.from(Buffer.concat(chunks, size));
}

export class NativeBoundedFetch implements BoundedFetch {
	constructor(private readonly logger?: Logger) {}

	async get(request: BoundedFetchRequest): Promise<BoundedFetchResponse> {
		if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > 64 * 1024 * 1024) {
			throw new FetchFailure('limit_exceeded');
		}
		const fetchId = randomUUID();
		const started = Date.now();
		logDiagnostic(this.logger, 'debug', 'OUTBOUND_FETCH_STARTED', { fetchId });
		try {
			let url = request.url;
			const policy = request.redirects;
			if (policy && (!Number.isSafeInteger(policy.max) || policy.max < 0 || policy.max > 8)) {
				throw new FetchFailure('unavailable');
			}
			for (let followed = 0; ; followed++) {
				if (policy && !policy.allow(url)) {
					throw new FetchFailure('unavailable');
				}
				const response = await fetch(url, {
					method: 'GET',
					headers: request.headers,
					signal: request.signal,
					redirect: policy ? 'manual' : 'error',
				});
				if (!policy || ![301, 302, 303, 307, 308].includes(response.status)) {
					const bytes = await body(response, request.maxBytes);
					logDiagnostic(this.logger, response.ok ? 'debug' : 'warn', 'OUTBOUND_FETCH_COMPLETED', {
						fetchId,
						status: response.status,
						bytes: bytes.byteLength,
						redirects: followed,
						durationMs: Date.now() - started,
					});
					return { status: response.status, bytes };
				}
				const location = response.headers.get('location');
				try {
					await response.body?.cancel();
				} catch (cause) {
					throw new FetchFailure('cleanup_failed', { cause });
				}
				if (followed >= policy.max || location === null) {
					throw new FetchFailure('unavailable');
				}
				url = new URL(location, url).href;
			}
		} catch (cause) {
			logDiagnostic(
				this.logger,
				'warn',
				'OUTBOUND_FETCH_FAILED',
				{ fetchId, durationMs: Date.now() - started, aborted: request.signal.aborted },
				cause,
			);
			if (cause instanceof FetchFailure) {
				throw cause;
			}
			throw new FetchFailure('unavailable', { cause });
		}
	}
}
