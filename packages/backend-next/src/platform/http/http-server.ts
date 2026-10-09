import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';

export interface HttpRouteContext {
	readonly method: string;
	readonly path: string;
	readonly query: URLSearchParams;
	readonly request: IncomingMessage;
	readonly response: ServerResponse;
	readonly sourceIp: string;
	json(): Promise<unknown>;
	cookie(name: string): string | null;
	send(status: number, body: unknown, headers?: Readonly<Record<string, string>>): void;
}

export interface HttpRoute {
	readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	readonly path: string;
	handle(context: HttpRouteContext): Promise<void>;
}

export interface HttpServerOptions {
	/** Explicit external URL prevents Host/X-Forwarded-Host origin spoofing. */
	publicOrigin: string;
	bindHost: string;
	port: number;
	trustedProxies: readonly string[];
	routes: readonly HttpRoute[];
}

export interface HttpListener {
	readonly address: string;
	close(): Promise<void>;
}

class HttpInputFailure extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}

function firstHeader(request: IncomingMessage, key: string): string | null {
	const raw = request.headers[key];
	if (Array.isArray(raw)) {
		return raw[0] ?? null;
	}
	return raw ?? null;
}

function cookie(request: IncomingMessage, name: string): string | null {
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

async function readJson(request: IncomingMessage): Promise<unknown> {
	const contentType = firstHeader(request, 'content-type');
	if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType.trim())) {
		throw new HttpInputFailure(415, 'unsupported_media_type');
	}
	if (Number(request.headers['content-length'] ?? 0) > 16384) {
		throw new HttpInputFailure(413, 'body_too_large');
	}
	let received = 0;
	const chunks: Buffer[] = [];
	for await (const raw of request) {
		const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
		received += chunk.length;
		if (received > 16384) {
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

function sendJson(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): void {
	if (response.writableEnded || response.destroyed) {
		return;
	}
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		...headers,
	});
	response.end(JSON.stringify(body));
}

function requestHost(request: IncomingMessage, trustedPeer: boolean): string | null {
	const forwardedHost = trustedPeer ? firstHeader(request, 'x-forwarded-host') : null;
	if (forwardedHost) {
		return forwardedHost.split(',').at(-1)?.trim() ?? null;
	}
	return firstHeader(request, 'host');
}

function requestProtocol(request: IncomingMessage, trustedPeer: boolean): string {
	const forwardedProto = trustedPeer ? firstHeader(request, 'x-forwarded-proto') : null;
	if (forwardedProto) {
		return forwardedProto.split(',').at(-1)?.trim() ?? '';
	}
	return 'encrypted' in request.socket && request.socket.encrypted === true ? 'https' : 'http';
}

function validateOrigin(request: IncomingMessage, expectedOrigin: URL, trustedPeer: boolean): void {
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
	} else if (site && site !== 'same-origin') {
		throw new HttpInputFailure(403, 'csrf_rejected');
	}
}

export async function openHttpListener(options: HttpServerOptions): Promise<HttpListener> {
	const origin = new URL(options.publicOrigin);
	if (
		!['http:', 'https:'].includes(origin.protocol) ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash ||
		origin.username ||
		origin.password ||
		!Number.isInteger(options.port) ||
		options.port < 0 ||
		options.port > 65535 ||
		!options.bindHost ||
		!(isIP(options.bindHost) || options.bindHost === 'localhost')
	) {
		throw new Error('Invalid HTTP listen or external origin');
	}
	const trust = proxyaddr.compile([...options.trustedProxies]);
	const routes = new Map<string, HttpRoute>();
	for (const route of options.routes) {
		const key = route.method + ' ' + route.path;
		if (routes.has(key)) {
			throw new Error('Duplicate HTTP route');
		}
		routes.set(key, route);
	}

	let accepting = true;
	const activeRequests = new Set<Promise<void>>();

	async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			const directIp = request.socket.remoteAddress ?? '';
			const trustedPeer = trust(directIp, 0);
			validateOrigin(request, origin, trustedPeer);
			const url = new URL(request.url ?? '/', origin);
			if (url.origin !== origin.origin) {
				throw new HttpInputFailure(400, 'invalid_path');
			}
			const method = request.method ?? '';
			const route = routes.get(method + ' ' + url.pathname);
			if (!route) {
				sendJson(response, 404, { code: 'not_found' });
				return;
			}
			const context: HttpRouteContext = {
				method,
				path: url.pathname,
				query: new URLSearchParams(url.searchParams),
				request,
				response,
				sourceIp: proxyaddr(request, trust),

				json: () => readJson(request),

				cookie: (name) => cookie(request, name),

				send: (status, body, headers) => sendJson(response, status, body, headers),
			};
			await route.handle(context);
		} catch (error) {
			const failure = error instanceof HttpInputFailure ? error : new HttpInputFailure(500, 'internal_failure');
			sendJson(response, failure.status, { code: failure.code });
		}
	}

	const server: Server = createServer((request, response) => {
		if (!accepting) {
			sendJson(response, 503, { code: 'shutting_down' });
			return;
		}
		const task = handleRequest(request, response);
		activeRequests.add(task);
		void task.finally(() => activeRequests.delete(task)).catch(() => undefined);
	});
	server.requestTimeout = 15000;
	server.headersTimeout = 10000;
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port, options.bindHost, () => {
			server.off('error', reject);
			resolve();
		});
	});
	const address = server.address();
	const boundAddress = address && typeof address !== 'string' ? address.address + ':' + address.port : '';

	let closePromise: Promise<void> | null = null;
	return {
		address: boundAddress,

		close(): Promise<void> {
			if (closePromise) {
				return closePromise;
			}
			// Admission closes synchronously, before the returned Promise is published.
			accepting = false;
			// Resolve with the failure so a shutdown error cannot reject before
			// already-admitted business handlers have finished draining.
			const serverClosed = new Promise<Error | null>((resolve) => {
				server.close((error) => resolve(error ?? null));
			});
			// Cancel incomplete HTTP transport, not its already-started business operation.
			server.closeAllConnections();
			closePromise = (async () => {
				const results = await Promise.allSettled([...activeRequests]);
				const serverFailure = await serverClosed;
				const failures = results
					.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
					.map((result) => result.reason);
				if (serverFailure !== null) {
					failures.push(serverFailure);
				}
				if (failures.length > 0) {
					throw new AggregateError(failures, 'HTTP request drain or listener close failed');
				}
			})();
			return closePromise;
		},
	};
}
