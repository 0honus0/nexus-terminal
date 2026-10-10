import { DEFAULT_JSON_BODY_BYTES } from './http-limits.js';
import proxyaddr from 'proxy-addr';
import type { HttpRouter } from './http-router.js';
import type { HttpRouteContext } from './http-types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpInputFailure } from './http-errors.js';

export function firstHeader(request: IncomingMessage, key: string): string | null {
	const raw = request.headers[key];
	if (Array.isArray(raw)) {
		return raw[0] ?? null;
	}
	return raw ?? null;
}

export function readRequestCookie(request: IncomingMessage, name: string): string | null {
	const raw = firstHeader(request, 'cookie');
	if (!raw || raw.length > 8192) {
		return null;
	}
	const parts = raw.split(';');
	const values = parts.map((item) => item.trim()).filter((item) => item.startsWith(name + '='));
	if (values.length !== 1) {
		return null;
	}
	return values[0].slice(name.length + 1);
}

export async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
	const contentType = firstHeader(request, 'content-type');
	if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType.trim())) {
		throw new HttpInputFailure(415, 'unsupported_media_type');
	}
	if (Number(request.headers['content-length'] ?? 0) > maxBodyBytes) {
		throw new HttpInputFailure(413, 'body_too_large');
	}
	let received = 0;
	const chunks: Buffer[] = [];
	for await (const raw of request) {
		const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
		received += chunk.length;
		if (received > maxBodyBytes) {
			throw new HttpInputFailure(413, 'body_too_large');
		}
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
	} catch {
		throw new HttpInputFailure(400, 'invalid_json');
	}
}

export function sendJson(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): void {
	if (response.writableEnded || response.destroyed) {
		return;
	}
	if (response.headersSent) {
		// A handler has already started its response. Never attempt a second
		// status/header block after an asynchronous failure.
		response.destroy();
		return;
	}
	const payload = JSON.stringify(body);
	if (payload === undefined) {
		throw new Error('HTTP JSON response body must be defined');
	}
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		...headers,
	});
	response.end(payload);
}

function requestHost(request: IncomingMessage, trustedPeer: boolean): string | null {
	const forwardedHost = trustedPeer ? firstHeader(request, 'x-forwarded-host') : null;
	if (forwardedHost) {
		// This deployment accepts exactly one external origin. Multiple proxy
		// assertions are ambiguous; do not guess which hop supplied the truth.
		return forwardedHost.includes(',') ? null : forwardedHost.trim();
	}
	return firstHeader(request, 'host');
}

function requestProtocol(request: IncomingMessage, trustedPeer: boolean): string {
	const forwardedProto = trustedPeer ? firstHeader(request, 'x-forwarded-proto') : null;
	if (forwardedProto) {
		return forwardedProto.includes(',') ? '' : forwardedProto.trim();
	}
	return 'encrypted' in request.socket && request.socket.encrypted === true ? 'https' : 'http';
}

export function validateOrigin(request: IncomingMessage, expectedOrigin: URL, trustedPeer: boolean): void {
	const host = requestHost(request, trustedPeer);
	const protocol = requestProtocol(request, trustedPeer);
	if (host !== expectedOrigin.host || protocol !== expectedOrigin.protocol.slice(0, -1)) {
		throw new HttpInputFailure(403, 'invalid_host');
	}
	if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
		return;
	}
	const site = firstHeader(request, 'sec-fetch-site');
	const rawOrigin = firstHeader(request, 'origin');
	if (site === 'same-site' || site === 'cross-site' || site === 'none') {
		throw new HttpInputFailure(403, 'csrf_rejected');
	}
	if (rawOrigin) {
		try {
			const origin = new URL(rawOrigin);
			if (origin.origin !== expectedOrigin.origin || rawOrigin !== origin.origin) {
				throw new HttpInputFailure(403, 'csrf_rejected');
			}
		} catch {
			throw new HttpInputFailure(403, 'csrf_rejected');
		}
	} else if (site !== 'same-origin') {
		// No origin and no positive browser same-origin metadata cannot prove
		// cookie-bearing mutation provenance.
		throw new HttpInputFailure(403, 'csrf_rejected');
	}
}

interface HttpRequestOptions {
	origin: URL;
	trust(address: string, index: number): boolean;
	router: HttpRouter;
}

export function createHttpRequestHandler(
	options: HttpRequestOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
	async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			const directIp = request.socket.remoteAddress ?? '';
			const trustedPeer = options.trust(directIp, 0);
			validateOrigin(request, options.origin, trustedPeer);
			const url = new URL(request.url ?? '/', options.origin);
			if (url.origin !== options.origin.origin) {
				throw new HttpInputFailure(400, 'invalid_path');
			}
			const method = request.method ?? '';
			const matched = options.router.match(method, url.pathname);
			if (!matched) {
				sendJson(response, 404, { code: 'not_found' });
				return;
			}
			const { route, params } = matched;
			const context: HttpRouteContext = {
				method,
				path: url.pathname,
				query: new URLSearchParams(url.searchParams),
				params,
				request,
				response,
				sourceIp: proxyaddr(request, options.trust),

				json: () => readJson(request, route.maxBodyBytes ?? DEFAULT_JSON_BODY_BYTES),

				cookie: (name) => readRequestCookie(request, name),

				send: (status, body, headers) => sendJson(response, status, body, headers),
			};
			await route.handle(context);
			if (!response.writableEnded && !response.destroyed) {
				// Incomplete handlers cannot leave an authorized HTTP request hanging.
				// A handler that already wrote headers cannot receive new JSON.
				if (response.headersSent) {
					response.destroy();
				} else {
					sendJson(response, 500, { code: 'internal_failure' });
				}
			}
		} catch (error) {
			if (response.headersSent) {
				// No second JSON envelope is valid after the first headers/body.
				response.destroy();
				return;
			}
			const failure = error instanceof HttpInputFailure ? error : new HttpInputFailure(500, 'internal_failure');
			sendJson(response, failure.status, { code: failure.code });
		}
	}

	return handleRequest;
}
