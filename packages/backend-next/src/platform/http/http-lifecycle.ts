import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket, WebSocketServer } from 'ws';
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

/** Admission is stopped by the listener before it publishes this shared cleanup task. */
export async function closeHttpResources(resources: HttpCloseResources): Promise<void> {
	for (const socket of resources.pendingUpgrades) {
		socket.destroy();
	}
	for (const socket of resources.activeSockets) {
		socket.terminate();
	}
	// Resolve with the failure so a shutdown error cannot reject before
	// already-admitted business handlers have finished draining.
	const serverClosed = new Promise<Error | null>((resolve) => {
		resources.server.close((error) => resolve(error ?? null));
	});
	// Cancel incomplete HTTP transport, not its already-started business operation.
	resources.server.closeAllConnections();

	const results = await Promise.allSettled([...resources.activeRequests]);
	// Upgrade auth and websocket handlers can still have Access/SQLite work.
	// Closing an upgrade can enqueue its onClose cleanup after the first
	// snapshot. Drain until no owned WebSocket task remains.
	while (resources.websocketTasks.size > 0) {
		await Promise.allSettled([...resources.websocketTasks]);
	}
	const webSocketServerClosed = new Promise<Error | null>((resolve) => {
		resources.websocketServer.close((error) => resolve(error ?? null));
	});
	const serverFailure = await serverClosed;
	// Closing the HTTP server may deliver the final upgrade/socket close
	// callbacks and register additional business cleanup tasks.
	while (resources.websocketTasks.size > 0) {
		await Promise.allSettled([...resources.websocketTasks]);
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
	failures.push(...resources.websocketFailures.errors());
	if (failures.length > 0) {
		throw new AggregateError(failures, 'HTTP request drain or listener close failed');
	}
}
