import { closeHttpResources } from './http-lifecycle.js';
import { MAX_WEBSOCKET_FRAME_BYTES } from './http-limits.js';
import { createServer, type Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import { WebSocket, WebSocketServer } from 'ws';
import type { HttpServerOptions, HttpListener, HttpWebSocketRoute } from './http-types.js';
import { firstHeader, validateOrigin, sendJson, createHttpRequestHandler } from './http-request.js';
import { compileHttpRoutes } from './http-router.js';
import { createWebSocketChannel } from './websocket-channel.js';
import { FailureSummary } from '../lifecycle/failure-summary.js';

export async function openHttpListener(options: HttpServerOptions): Promise<HttpListener> {
	const origin = validateHttpOptions(options);
	const trust = proxyaddr.compile([...options.trustedProxies]);
	const websocketServer = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_WEBSOCKET_FRAME_BYTES,
		perMessageDeflate: false,
	});
	const activeSockets = new Set<WebSocket>();
	const pendingUpgrades = new Set<Duplex>();
	const websocketTasks = new Set<Promise<unknown>>();
	const websocketFailures = new FailureSummary();
	const webSocketRoutes = new Map<string, HttpWebSocketRoute>();
	for (const route of options.webSockets ?? []) {
		if (webSocketRoutes.has(route.path)) {
			throw new Error('Duplicate websocket route');
		}
		webSocketRoutes.set(route.path, route);
	}
	const router = compileHttpRoutes(options.routes);

	let accepting = true;
	const activeRequests = new Set<Promise<void>>();

	const handleRequest = createHttpRequestHandler({ origin, trust, router });

	const server: Server = createServer((request, response) => {
		if (!accepting) {
			sendJson(response, 503, { code: 'shutting_down' });
			return;
		}
		const task = handleRequest(request, response);
		activeRequests.add(task);
		void task.finally(() => activeRequests.delete(task)).catch(() => undefined);
	});

	function trackWebSocketTask(task: Promise<unknown>, observeFailure = false): void {
		websocketTasks.add(task);
		if (observeFailure) {
			void task.catch((error: unknown) => websocketFailures.record(error));
		}
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
			let authorized: boolean;
			try {
				authorized = await route.authorize(request, url);
			} catch {
				reject(503);
				return;
			}
			if (!authorized) {
				reject(401);
				return;
			}
			if (!accepting || socket.destroyed) {
				reject(503);
				return;
			}
			websocketServer.handleUpgrade(request, socket, head, (ws) => {
				activeSockets.add(ws);
				const channel = createWebSocketChannel(ws, {
					isAccepting: () => accepting,

					trackTask: trackWebSocketTask,

					onClosed: () => activeSockets.delete(ws),
				});
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
		pendingUpgrades.add(socket);
		const task = upgrade(request, socket, head);
		trackWebSocketTask(
			task.finally(() => pendingUpgrades.delete(socket)),
			true,
		);
	});
	await listen(server, options);
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
			closePromise = Promise.resolve().then(() =>
				closeHttpResources({
					server,
					websocketServer,
					activeSockets,
					pendingUpgrades,
					activeRequests,
					websocketTasks,
					websocketFailures,
				}),
			);
			return closePromise;
		},
	};
}

function validateHttpOptions(options: HttpServerOptions): URL {
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

	return origin;
}

async function listen(server: Server, options: HttpServerOptions): Promise<void> {
	server.requestTimeout = 15000;
	server.headersTimeout = 10000;
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port, options.bindHost, () => {
			server.off('error', reject);
			resolve();
		});
	});
}
