import { once } from 'node:events';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';

/** Real WS transport; the address mapping replaces only the old test Vite proxy. */
export async function openWorkspacePeer() {
	const server = new WebSocket.WebSocketServer({ host: '127.0.0.1', port: 0 });
	await once(server, 'listening');
	const clients = new Set();
	class DirectWorkspacePeer extends WebSocket {
		constructor(url, protocols) {
			const endpoint = new URL(url);
			endpoint.host = '127.0.0.1:' + server.address().port;
			super(endpoint, protocols);
			clients.add(this);
		}
	}
	let closing;
	return {
		server,
		WebSocket: DirectWorkspacePeer,

		close() {
			closing ??= Promise.resolve().then(async () => {
				const outcomes = await Promise.allSettled([
					...[...clients].map(async (socket) => {
						if (socket.readyState === WebSocket.CLOSED) return;
						const closed = once(socket, 'close');
						socket.terminate();
						await closed;
					}),
					new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
				]);
				const failures = outcomes
					.filter((result) => result.status === 'rejected')
					.map((result) => result.reason);
				if (failures.length) throw new AggregateError(failures, 'Workspace peer cleanup failed');
			});
			return closing;
		},
	};
}
