import { closeHttpResources, drainHttpTransport, waitForResponse } from './http-lifecycle.js';
import { MAX_WEBSOCKET_FRAME_BYTES } from './http-limits.js';
import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import { WebSocket, WebSocketServer } from 'ws';
import type { HttpServerOptions, HttpListener, HttpSuspension } from './http-types.js';
import { firstHeader, validateOrigin, sendJson } from './http-request.js';
import { compileHttpBindings } from './http-bindings.js';
import { HttpLifecycleFailure } from './http-errors.js';
import { createWebSocketChannel } from './websocket-channel.js';
import { FailureSummary } from '../lifecycle/failure-summary.js';

export async function openHttpListener(options: HttpServerOptions): Promise<HttpListener> {
	validateHttpOptions(options);
	const trust = proxyaddr.compile([...options.trustedProxies]);
	let bindings = compileHttpBindings(options.publicOrigin, options, trust);
	const websocketServer = new WebSocketServer({
		noServer: true,
		// Raw third-party protocols may remove their socket 'close' listeners.
		// The HTTP owner tracks sockets/tasks itself rather than relying on
		// ws's internal clientTracking registry for graceful listener close.
		clientTracking: false,
		maxPayload: MAX_WEBSOCKET_FRAME_BYTES,
		perMessageDeflate: false,
	});
	const activeSockets = new Set<WebSocket>();
	const pendingUpgrades = new Set<Duplex>();
	const websocketTasks = new Set<Promise<unknown>>();
	const websocketFailures = new FailureSummary();
	let accepting = true;
	let generation = 0;
	let suspension: HttpSuspension | null = null;
	const activeRequests = new Set<Promise<void>>();
	const requests = new Map<IncomingMessage, { response: ServerResponse; task: Promise<void> }>();

	const server: Server = createServer((request, response) => {
		if (!accepting) {
			sendJson(response, 503, { code: 'shutting_down' }, { Connection: 'close' });
			return;
		}
		const completed = waitForResponse(response, request);
		const handler = bindings.handle;
		// Publish ownership before any synchronous handler can enter maintenance.
		const task = Promise.resolve().then(async () => {
			try {
				await handler(request, response);
			} catch (error) {
				response.destroy();
				throw error;
			} finally {
				await completed;
			}
		});
		activeRequests.add(task);
		requests.set(request, { response, task });
		void task
			.finally(() => {
				activeRequests.delete(task);
				requests.delete(request);
			})
			.catch(() => undefined);
	});

	function trackWebSocketTask(task: Promise<unknown>, observeFailure = false): void {
		websocketTasks.add(task);
		if (observeFailure) {
			void task.catch((error: unknown) => websocketFailures.record(error));
		}
		void task.finally(() => websocketTasks.delete(task)).catch(() => undefined);
	}

	async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
		const admittedGeneration = generation;
		const admittedBindings = bindings;

		const reject = (status: number) => {
			if (!socket.destroyed) {
				socket.end('HTTP/1.1 ' + status + ' Rejected\r\nConnection: close\r\n\r\n');
			}
		};

		try {
			const trustedPeer = trust(request.socket.remoteAddress ?? '', 0);
			const origin = validateOrigin(request, admittedBindings.origins, trustedPeer);
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
			const route = admittedBindings.webSockets.get(url.pathname);
			if (!route || url.origin !== origin.origin) {
				reject(404);
				return;
			}
			let authorized: boolean;
			try {
				authorized = await route.authorize(request, url, proxyaddr(request, trust));
			} catch {
				reject(503);
				return;
			}
			if (!authorized) {
				reject(401);
				return;
			}
			if (!accepting || generation !== admittedGeneration || socket.destroyed) {
				reject(503);
				return;
			}
			websocketServer.handleUpgrade(request, socket, head, (ws) => {
				activeSockets.add(ws);
				if (route.connectedRaw) {
					ws.on('error', () => ws.terminate());
					ws.once('close', () => activeSockets.delete(ws));
					try {
						// The raw owner's task includes the entire session
						// lifetime, not just its handshake.
						trackWebSocketTask(
							Promise.resolve(route.connectedRaw(ws, request, url)).finally(() => {
								// guacamole-lite may remove HTTP's close listener.
								// An unresolved technical close must retain the
								// socket for another shutdown attempt rather than
								// treating a rejected raw task as closed.
								if (ws.readyState === WebSocket.CLOSED) {
									activeSockets.delete(ws);
								}
							}),
							true,
						);
					} catch (error) {
						websocketFailures.record(error);
						ws.terminate();
					}
					return;
				}
				const channel = createWebSocketChannel(ws, {
					isAccepting: () => accepting && generation === admittedGeneration,

					maxBinaryMessageBytes: route.maxBinaryMessageBytes,
					maxTextMessageBytes: route.maxTextMessageBytes,
					maxBufferedTextBytes: route.maxBufferedTextBytes,

					trackTask: trackWebSocketTask,

					onClosed: () => activeSockets.delete(ws),
				});
				try {
					route.connected?.(channel, request, url);
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

	function suspend(owner?: IncomingMessage): HttpSuspension {
		if (closePromise || suspension || !accepting) {
			throw new HttpLifecycleFailure('invalid_state');
		}
		if (owner) {
			const entry = requests.get(owner);
			const sharedSocket = [...requests.keys()].some(
				(request) => request !== owner && request.socket === owner.socket,
			);
			if (
				!entry ||
				entry.response.writableFinished ||
				entry.response.destroyed ||
				owner.socket.destroyed ||
				sharedSocket
			) {
				throw new HttpLifecycleFailure('invalid_owner');
			}
		}
		accepting = false;
		generation += 1;
		let drainPromise: Promise<void> | null = null;
		let drained = false;
		let replaced = false;

		function assertCurrent(): void {
			if (closePromise || suspension !== lease) {
				throw new HttpLifecycleFailure('invalid_state');
			}
		}

		const lease: HttpSuspension = {
			drain(): Promise<void> {
				if (drainPromise) {
					return drainPromise;
				}
				try {
					assertCurrent();
				} catch (error) {
					return Promise.reject(error);
				}
				drainPromise = Promise.resolve().then(async () => {
					try {
						await drainHttpTransport({
							requests,
							owner,
							activeSockets,
							pendingUpgrades,
							websocketTasks,
							websocketFailures,
						});
						assertCurrent();
						drained = true;
					} catch (cause) {
						throw new HttpLifecycleFailure('drain_failed', { cause });
					}
				});
				return drainPromise;
			},

			replace(replacement): void {
				assertCurrent();
				if (!drained || replaced) {
					throw new HttpLifecycleFailure('invalid_state');
				}
				bindings = compileHttpBindings(options.publicOrigin, replacement, trust);
				replaced = true;
			},

			resume(): void {
				assertCurrent();
				if (!drained || !replaced) {
					throw new HttpLifecycleFailure('invalid_state');
				}
				suspension = null;
				accepting = true;
			},
		};
		suspension = lease;
		return lease;
	}

	return {
		address: boundAddress,
		suspend,

		close(): Promise<void> {
			if (closePromise) {
				return closePromise;
			}
			// Admission closes synchronously, before the returned Promise is published.
			accepting = false;
			generation += 1;
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

function validateHttpOptions(options: HttpServerOptions): void {
	if (
		!Number.isInteger(options.port) ||
		options.port < 0 ||
		options.port > 65535 ||
		!options.bindHost ||
		!(isIP(options.bindHost) || options.bindHost === 'localhost')
	) {
		throw new Error('Invalid HTTP bind address or port');
	}
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
