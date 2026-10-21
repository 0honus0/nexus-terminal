import { HttpRequestFailure } from './request-failure';
import { readResponseBytes } from './response-body';
import { isNetworkFailure, reportNetworkFailure } from './network-failure';

interface BinaryRequest {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	url: string;
	body?: string | FormData | Blob;
	headers?: Record<string, string>;
	maxRequestBytes: number;
	maxResponseBytes: number;
	maxErrorBytes: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

function bodySize(body: BinaryRequest['body']): number {
	if (body === undefined) {
		return 0;
	}
	if (body instanceof FormData) {
		let total = 0;
		for (const [key, value] of body) {
			total += new Blob([key]).size + (typeof value === 'string' ? new Blob([value]).size : value.size);
		}
		return total;
	}
	return typeof body === 'string' ? new Blob([body]).size : body.size;
}

/** Finite same-origin binary/multipart transport; feature APIs own media types and business codecs. */
export async function requestBinary(
	input: BinaryRequest,
): Promise<{ status: number; headers: Headers; bytes: Uint8Array<ArrayBuffer> }> {
	const timeoutMs = input.timeoutMs ?? 15000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 4294967295) {
		throw new HttpRequestFailure('invalid_input', 'not_dispatched');
	}
	const deadline = AbortSignal.timeout(timeoutMs);
	const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
	if (signal.aborted) {
		throw new HttpRequestFailure('cancelled', 'not_dispatched');
	}
	let request: Request;
	try {
		const url = new URL(input.url, window.location.href);
		if (
			url.origin !== window.location.origin ||
			url.username ||
			url.password ||
			url.hash ||
			![input.maxRequestBytes, input.maxResponseBytes, input.maxErrorBytes].every(
				(value) => Number.isSafeInteger(value) && value > 0,
			) ||
			bodySize(input.body) > input.maxRequestBytes
		) {
			throw new Error('Invalid binary request');
		}
		const original = new Request(url, { method: input.method, body: input.body, headers: input.headers });
		const body = input.body === undefined ? undefined : await original.blob();
		if (body && body.size > input.maxRequestBytes) {
			throw new Error('Encoded request budget exceeded');
		}
		request = new Request(url, {
			method: input.method,
			body,
			headers: original.headers,
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal,
		});
	} catch (cause) {
		throw new HttpRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
	if (signal.aborted) {
		throw new HttpRequestFailure(input.signal?.aborted ? 'cancelled' : 'request_failed', 'not_dispatched');
	}
	let response: Response;
	try {
		response = await fetch(request);
	} catch (cause) {
		if (!input.signal?.aborted) reportNetworkFailure();
		throw new HttpRequestFailure(input.signal?.aborted ? 'cancelled' : 'request_failed', 'unknown', { cause });
	}
	try {
		const bytes = await readResponseBytes(
			response,
			response.status >= 400 ? input.maxErrorBytes : input.maxResponseBytes,
		);
		return { status: response.status, headers: response.headers, bytes };
	} catch (cause) {
		if (input.signal?.aborted) {
			throw new HttpRequestFailure('cancelled', 'unknown', { cause });
		}
		if (isNetworkFailure(cause)) reportNetworkFailure();
		throw cause;
	}
}
