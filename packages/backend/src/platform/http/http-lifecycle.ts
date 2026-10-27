import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, type WebSocketServer } from 'ws';
import type { FailureSummary } from '../lifecycle/failure-summary.js';

interface HttpCloseResources {
	server: Server;
	websocketServer: WebSocketServer;
	activeSockets: Set<WebSocket>;
	pendingUpgrades: Set<Duplex>;
	activeRequests: Set<Promise<void>>;
	websocketTasks: Set<Promise<unknown>>;
	websocketFailures: FailureSummary;
}

interface HttpDrainResources {
	requests: ReadonlyMap<IncomingMessage, { response: ServerResponse; task: Promise<void> }>;
	owner?: IncomingMessage;
	activeSockets: Set<WebSocket>;
	pendingUpgrades: Set<Duplex>;
	websocketTasks: Set<Promise<unknown>>;
	websocketFailures: FailureSummary;
}

async function confirmWebSocketClosure(sockets: ReadonlySet<WebSocket>): Promise<boolean> {
	const deadline = performance.now() + 10000;
	while ([...sockets].some((socket) => socket.readyState !== WebSocket.CLOSED)) {
		if (performance.now() >= deadline) {
			return false;
		}
		await delay(10);
	}
	return true;
}

/** A returned business handler does not prove its response has finished on the transport. */
export function waitForResponse(response: ServerResponse, request: IncomingMessage): Promise<void> {
	const socket = response.socket;
	if (response.writableFinished || response.destroyed || socket?.destroyed || request.aborted) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		const finished = () => {
			response.off('finish', finished);
			response.off('close', finished);
			response.off('error', failed);
			socket?.off('close', finished);
			request.off('aborted', finished);
			resolve();
		};

		const failed = () => response.destroy();

		response.once('finish', finished);
		response.once('close', finished);
		response.once('error', failed);
		// An aborted request can lose its response close notification while the
		// handler is still unwinding. The original socket is the transport owner.
		socket?.once('close', finished);
		request.once('aborted', finished);
	});
}

/** The TCP listener and the maintenance owner's response stay alive; every other admitted owner drains. */
export async function drainHttpTransport(resources: HttpDrainResources): Promise<void> {
	const requests = [...resources.requests].filter(([request]) => request !== resources.owner);
	const failures: unknown[] = [];

	const attempt = (cleanup: () => void) => {
		try {
			cleanup();
		} catch (error) {
			failures.push(error);
		}
	};

	for (const socket of resources.pendingUpgrades) {
		attempt(() => socket.destroy());
	}
	for (const socket of resources.activeSockets) {
		attempt(() => socket.terminate());
	}
	for (const [request, { response }] of requests) {
		attempt(() => response.destroy());
		attempt(() => request.destroy());
	}
	const outcomes = await Promise.allSettled(requests.map(([, entry]) => entry.task));
	while (resources.websocketTasks.size > 0) {
		await Promise.allSettled([...resources.websocketTasks]);
	}
	// A raw vendor may remove HTTP's close listener. Check the real socket state,
	// rather than trusting registry removal or a handler's returned Promise.
	if (!(await confirmWebSocketClosure(resources.activeSockets))) {
		failures.push(new Error('WebSocket maintenance close confirmation unknown'));
	}
	while (resources.websocketTasks.size > 0) {
		await Promise.allSettled([...resources.websocketTasks]);
	}
	failures.push(...outcomes.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])));
	failures.push(...resources.websocketFailures.errors());
	if (failures.length) {
		throw new AggregateError(failures, 'HTTP maintenance drain failed');
	}
	resources.activeSockets.clear();
}

/** Admission is stopped by the listener before it publishes this shared cleanup task. */
export async function closeHttpResources(resources: HttpCloseResources): Promise<void> {
	const failures: unknown[] = [];

	const attempt = (cleanup: () => void) => {
		try {
			cleanup();
		} catch (error) {
			failures.push(error);
		}
	};

	const closeServer = (close: (done: (error?: Error) => void) => void): Promise<void> =>
		new Promise((resolve) => {
			try {
				close((error) => {
					if (error) {
						failures.push(error);
					}
					resolve();
				});
			} catch (error) {
				failures.push(error);
				resolve();
			}
		});

	for (const socket of resources.pendingUpgrades) {
		attempt(() => socket.destroy());
	}
	for (const socket of resources.activeSockets) {
		attempt(() => socket.terminate());
	}
	// Resolve with the failure so a shutdown error cannot reject before
	// already-admitted business handlers have finished draining.
	const serverClosed = closeServer((done) => resources.server.close(done));
	// Cancel incomplete HTTP transport, not its already-started business operation.
	attempt(() => resources.server.closeAllConnections());

	const results = await Promise.allSettled([...resources.activeRequests]);
	// Upgrade auth and websocket handlers can still have Access/SQLite work.
	// Closing an upgrade can enqueue its onClose cleanup after the first
	// snapshot. Drain until no owned WebSocket task remains.
	while (resources.websocketTasks.size > 0) {
		await Promise.allSettled([...resources.websocketTasks]);
	}
	const webSocketServerClosed = closeServer((done) => resources.websocketServer.close(done));
	await serverClosed;
	// Closing the HTTP server may deliver the final upgrade/socket close
	// callbacks and register additional business cleanup tasks.
	while (resources.websocketTasks.size > 0) {
		await Promise.allSettled([...resources.websocketTasks]);
	}
	await webSocketServerClosed;
	// ws.terminate() starts asynchronous TCP teardown; a server without client
	// tracking can close before each socket emits close and registers cleanup.
	// Raw vendors may also remove HTTP's listener: inspect actual socket state.
	if (!(await confirmWebSocketClosure(resources.activeSockets))) {
		failures.push(new Error('WebSocket close confirmation unknown'));
	}
	while (resources.websocketTasks.size > 0) {
		await Promise.allSettled([...resources.websocketTasks]);
	}
	failures.push(...results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])));
	failures.push(...resources.websocketFailures.errors());
	if (failures.length > 0) {
		throw new AggregateError(failures, 'HTTP request drain or listener close failed');
	}
}
