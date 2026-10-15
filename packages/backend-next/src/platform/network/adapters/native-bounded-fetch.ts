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
		return Uint8Array.from(Buffer.concat(chunks, size));
	} catch (cause) {
		try {
			await reader.cancel();
		} catch (cleanup) {
			throw new FetchFailure('cleanup_failed', {
				cause: new AggregateError([cause, cleanup], 'Fetch read and release failed'),
			});
		}
		throw cause;
	} finally {
		reader.releaseLock();
	}
}

export class NativeBoundedFetch implements BoundedFetch {
	async get(request: BoundedFetchRequest): Promise<BoundedFetchResponse> {
		if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > 64 * 1024 * 1024) {
			throw new FetchFailure('limit_exceeded');
		}
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
					return { status: response.status, bytes: await body(response, request.maxBytes) };
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
			if (cause instanceof FetchFailure) {
				throw cause;
			}
			throw new FetchFailure('unavailable', { cause });
		}
	}
}
