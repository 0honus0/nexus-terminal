import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import { WebSocketServer, WebSocket } from 'ws';
import type { Duplex } from 'node:stream';

export interface HttpRouteContext {
	readonly method: string;
	readonly path: string;
	readonly query: URLSearchParams;
	readonly params: Readonly<Record<string, string>>;
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
	webSockets?: readonly HttpWebSocketRoute[];
}

/** Technology-only channel. Message parsing, authorization and sessions belong to modules. */
export interface HttpWebSocketChannel {
	send(value: string): boolean;
	onMessage(listener: (value: string) => Promise<void>): void;
	onClose(listener: () => Promise<void>): void;
	/** Flush ordered frames and finish the close handshake within a bounded deadline. */
	finish(): Promise<void>;
	/** Reject further traffic immediately; intended for revoke/error/shutdown. */
	close(): void;
}

export interface HttpWebSocketRoute {
	path: string;
	authorize(request: IncomingMessage, url: URL): Promise<boolean>;
	connected(channel: HttpWebSocketChannel, request: IncomingMessage, url: URL): void;
}

export interface HttpListener {
	readonly address: string;
	close(): Promise<void>;
}

export class HttpInputFailure extends Error {
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
	const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
	const activeSockets = new Set<WebSocket>();
	const websocketTasks = new Set<Promise<unknown>>();
	const webSocketRoutes = new Map<string, HttpWebSocketRoute>();
	for (const route of options.webSockets ?? []) {
		if (webSocketRoutes.has(route.path)) {
			throw new Error('Duplicate websocket route');
		}
		webSocketRoutes.set(route.path, route);
	}
	const routes = new Map<string, HttpRoute>();
	const parameterized: { route: HttpRoute; parts: string[] }[] = [];
	for (const route of options.routes) {
		const key = route.method + ' ' + route.path;
		if (routes.has(key)) {
			throw new Error('Duplicate HTTP route');
		}
		routes.set(key, route);
		if (route.path.split('/').some((part) => part.startsWith(':'))) {
			parameterized.push({ route, parts: route.path.split('/') });
		}
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
			let route = routes.get(method + ' ' + url.pathname);
			const params: Record<string, string> = {};
			if (!route) {
				const actualParts = url.pathname.split('/');
				for (const entry of parameterized) {
					if (entry.route.method !== method || entry.parts.length !== actualParts.length) {
						continue;
					}
					const candidate: Record<string, string> = {};
					const matched = entry.parts.every((part, index) => {
						const actual = actualParts[index];
						if (part.startsWith(':')) {
							if (!actual || !/^[A-Za-z0-9_-]{1,64}$/u.test(actual)) {
								return false;
							}
							candidate[part.slice(1)] = actual;
							return true;
						}
						return part === actual;
					});
					if (matched) {
						route = entry.route;
						Object.assign(params, candidate);
						break;
					}
				}
			}
			if (!route) {
				sendJson(response, 404, { code: 'not_found' });
				return;
			}
			const context: HttpRouteContext = {
				method,
				path: url.pathname,
				query: new URLSearchParams(url.searchParams),
				params,
				request,
				response,
				sourceIp: proxyaddr(request, trust),

				json: () => readJson(request),

				cookie: (name) => readRequestCookie(request, name),

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

	function trackWebSocketTask(task: Promise<unknown>): void {
		websocketTasks.add(task);
		void task.finally(() => websocketTasks.delete(task)).catch(() => undefined);
	}

	async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
		const reject = (status: number) => {
			if (!socket.destroyed) {
				socket.end('HTTP/1.1 ' + status + ' Rejected\r\nConnection: close\r\n\r\n');
			}
		};

		try {
			const trustedPeer = trust(request.socket.remoteAddress ?? '', 0);
			validateOrigin(request, origin, trustedPeer);
			// GET upgrade needs a strict Origin; never inherit ordinary GET exemption.
			if (
				request.method !== 'GET' ||
				firstHeader(request, 'origin') !== origin.origin ||
				(firstHeader(request, 'sec-fetch-site') ?? 'same-origin') !== 'same-origin'
			) {
				reject(403);
				return;
			}
			const url = new URL(request.url ?? '/', origin);
			const route = webSocketRoutes.get(url.pathname);
			if (!route || url.origin !== origin.origin) {
				reject(404);
				return;
			}
			if (!(await route.authorize(request, url))) {
				reject(401);
				return;
			}
			if (!accepting || socket.destroyed) {
				reject(503);
				return;
			}
			websocketServer.handleUpgrade(request, socket, head, (ws) => {
				activeSockets.add(ws);
				let listener: ((value: string) => Promise<void>) | null = null;
				let closing: (() => Promise<void>) | null = null;
				let incoming = Promise.resolve();
				let queuedMessages = 0;
				let queuedBytes = 0;
				let finishing: Promise<void> | null = null;
				const MAX_INPUT_MESSAGES = 64;
				const MAX_INPUT_BYTES = 256 * 1024;
				ws.on('message', (data, isBinary) => {
					if (isBinary || !listener || finishing || !accepting) {
						ws.terminate();
						return;
					}
					const message = data.toString();
					const bytes = Buffer.byteLength(message);
					if (queuedMessages >= MAX_INPUT_MESSAGES || queuedBytes + bytes > MAX_INPUT_BYTES) {
						ws.terminate();
						return;
					}
					queuedMessages += 1;
					queuedBytes += bytes;
					const current = incoming.then(async () => {
						try {
							if (ws.readyState === WebSocket.OPEN && listener) {
								await listener(message);
							}
						} finally {
							queuedMessages -= 1;
							queuedBytes -= bytes;
						}
					});
					incoming = current.catch(() => ws.terminate());
					// One chain per socket, rather than tracking every ancestor Promise.
					trackWebSocketTask(current.catch(() => undefined));
				});
				ws.on('close', () => {
					activeSockets.delete(ws);
					if (closing) {
						trackWebSocketTask(Promise.resolve().then(closing));
					}
				});
				const channel: HttpWebSocketChannel = {
					send(value) {
						if (
							ws.readyState !== WebSocket.OPEN ||
							ws.bufferedAmount + Buffer.byteLength(value) > 1024 * 1024
						) {
							return false;
						}
						ws.send(value, (error) => {
							if (error) ws.terminate();
						});
						return true;
					},

					onMessage(callback) {
						listener = callback;
					},

					onClose(callback) {
						closing = callback;
					},

					finish() {
						if (finishing) return finishing;
						finishing = new Promise<void>((resolve) => {
							if (ws.readyState === WebSocket.CLOSED) {
								resolve();
								return;
							}
							const deadline = setTimeout(() => ws.terminate(), 5000);
							deadline.unref();
							ws.once('close', () => {
								clearTimeout(deadline);
								resolve();
							});
							if (ws.readyState === WebSocket.OPEN) {
								ws.close(1000);
							} else {
								ws.terminate();
							}
						});
						return finishing;
					},

					close() {
						ws.terminate();
					},
				};
				try {
					route.connected(channel, request, url);
				} catch {
					ws.terminate();
				}
			});
		} catch {
			reject(403);
		}
	}

	server.on('upgrade', (request, socket, head) => {
		if (!accepting) {
			socket.destroy();
			return;
		}
		trackWebSocketTask(upgrade(request, socket, head));
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
			for (const socket of activeSockets) {
				socket.terminate();
			}
			// Resolve with the failure so a shutdown error cannot reject before
			// already-admitted business handlers have finished draining.
			const serverClosed = new Promise<Error | null>((resolve) => {
				server.close((error) => resolve(error ?? null));
			});
			// Cancel incomplete HTTP transport, not its already-started business operation.
			server.closeAllConnections();
			closePromise = (async () => {
				const results = await Promise.allSettled([...activeRequests]);
				// Upgrade auth and websocket handlers can still have Access/SQLite work.
				// Closing an upgrade can enqueue its onClose cleanup after the first
				// snapshot. Drain until no owned WebSocket task remains.
				while (websocketTasks.size > 0) {
					await Promise.allSettled([...websocketTasks]);
				}
				const webSocketServerClosed = new Promise<Error | null>((resolve) => {
					websocketServer.close((error) => resolve(error ?? null));
				});
				const serverFailure = await serverClosed;
				// Closing the HTTP server may deliver the final upgrade/socket close
				// callbacks and register additional business cleanup tasks.
				while (websocketTasks.size > 0) {
					await Promise.allSettled([...websocketTasks]);
				}
				const webSocketFailure = await webSocketServerClosed;
				const failures = results
					.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
					.map((result) => result.reason);
				if (serverFailure !== null) {
					failures.push(serverFailure);
				}
				if (webSocketFailure !== null) {
					failures.push(webSocketFailure);
				}
				if (failures.length > 0) {
					throw new AggregateError(failures, 'HTTP request drain or listener close failed');
				}
			})();
			return closePromise;
		},
	};
}
