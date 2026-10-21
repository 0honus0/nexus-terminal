import { HttpRequestFailure } from './request-failure';
import { readResponseBytes, rejectResponse } from './response-body';
import { isNetworkFailure, reportNetworkFailure } from './network-failure';

export interface JsonRequest {
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	url: string;
	headers?: Readonly<Record<string, string>>;
	body?: unknown;
	maxRequestBytes: number;
	maxResponseBytes: number;
	signal?: AbortSignal;
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
	if (response.status === 204) {
		const length = response.headers.get('content-length');
		if (response.body !== null || (length !== null && length !== '0')) {
			return rejectResponse(response, new HttpRequestFailure('protocol_failure', 'unknown'));
		}
		return undefined;
	}
	const contentType = response.headers.get('content-type');
	if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType.trim())) {
		return rejectResponse(response, new HttpRequestFailure('protocol_failure', 'unknown'));
	}
	const bytes = await readResponseBytes(response, maxBytes);
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (cause) {
		throw new HttpRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

/** Bounded same-origin JSON transport. Business codecs and authentication belong to their feature owners. */
export async function requestJson(input: JsonRequest): Promise<{ status: number; body: unknown }> {
	if (input.signal?.aborted) {
		throw new HttpRequestFailure('cancelled', 'not_dispatched');
	}
	let body: string | undefined;
	let headers: Headers;
	try {
		const url = new URL(input.url, window.location.href);
		if (url.origin !== window.location.origin || url.username || url.password || url.hash) {
			throw new Error('Invalid request origin');
		}
		if (
			!Number.isSafeInteger(input.maxRequestBytes) ||
			input.maxRequestBytes < 1 ||
			!Number.isSafeInteger(input.maxResponseBytes) ||
			input.maxResponseBytes < 1
		) {
			throw new Error('Invalid JSON budget');
		}
		body = input.body === undefined ? undefined : JSON.stringify(input.body);
		headers = new Headers(input.headers);
		headers.set('Accept', 'application/json');
		if (body !== undefined) {
			headers.set('Content-Type', 'application/json');
		}
		if (input.body !== undefined && body === undefined) {
			throw new Error('Request cannot be encoded');
		}
		if (body !== undefined && new TextEncoder().encode(body).byteLength > input.maxRequestBytes) {
			throw new Error('Request budget exceeded');
		}
	} catch (cause) {
		throw new HttpRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
	let response: Response;
	const deadline = AbortSignal.timeout(15_000);
	const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
	try {
		response = await fetch(input.url, {
			method: input.method,
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal,
			headers,
			body,
		});
	} catch (cause) {
		if (!input.signal?.aborted) reportNetworkFailure();
		throw new HttpRequestFailure(input.signal?.aborted ? 'cancelled' : 'request_failed', 'unknown', { cause });
	}
	try {
		return { status: response.status, body: await readJson(response, input.maxResponseBytes) };
	} catch (cause) {
		if (input.signal?.aborted) {
			throw new HttpRequestFailure('cancelled', 'unknown', { cause });
		}
		if (isNetworkFailure(cause)) reportNetworkFailure();
		throw cause;
	}
}
