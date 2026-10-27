const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromBackend = createRequire(path.resolve(__dirname, '../../../packages/backend/package.json'));
const { WebSocket } = requireFromBackend('ws');
const publicPort = Number(
	process.env.NEXUS_E2E_SUITE === 'backend'
		? process.env.NEXUS_E2E_BACKEND_PORT || 3001
		: process.env.NEXUS_E2E_FRONTEND_PORT || 4173,
);
const targetOrigin = `http://localhost:${publicPort}`;
const targetWebSocketOrigin = `ws://localhost:${publicPort}`;

const createSocket = (ticket, cookie) =>
	new WebSocket(`${targetWebSocketOrigin}/ws/remote-desktop?ticket=${encodeURIComponent(ticket)}`, {
		headers: {
			Cookie: cookie,
			Origin: targetOrigin,
		},
	});

const openRemoteDesktopWebSocket = (ticket, cookie) =>
	new Promise((resolve, reject) => {
		const socket = createSocket(ticket, cookie);
		const timer = setTimeout(() => {
			socket.terminate();
			reject(new Error('Timed out waiting for RDCleanPath data from backend.'));
		}, 10_000);

		const der = (tag, bytes) => Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);

		socket.once('open', () => {
			const x224 = Buffer.from([3, 0, 0, 19, 14, 224, 0, 0, 0, 0, 0, 1, 0, 8, 0, 3, 0, 0, 0]);
			socket.send(
				der(
					0x30,
					Buffer.concat([
						der(0xa0, der(2, Buffer.from([0x0d, 0x3e]))),
						der(0xa2, der(0x0c, Buffer.from('ignored.invalid:3389'))),
						der(0xa3, der(0x0c, Buffer.alloc(0))),
						der(0xa6, der(4, x224)),
					]),
				),
			);
		});
		socket.on('message', (message) => {
			const text = message.toString('hex');
			if (!text.startsWith('30')) return;
			clearTimeout(timer);
			resolve({
				firstMessage: text,

				close: () => socket.close(),
			});
		});
		socket.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});

const waitForRemoteDesktopTicketRejection = (ticket, cookie) =>
	new Promise((resolve, reject) => {
		const socket = createSocket(ticket, cookie);
		const timer = setTimeout(() => {
			socket.terminate();
			reject(new Error('Timed out waiting for remote desktop ticket rejection.'));
		}, 5_000);
		socket.once('close', (code, reason) => {
			clearTimeout(timer);
			resolve({ code, reason: reason.toString() });
		});
		socket.once('unexpected-response', (_request, response) => {
			clearTimeout(timer);
			response.resume();
			reject(new Error(`Expected WebSocket close but received HTTP ${response.statusCode}.`));
		});
		socket.once('error', () => {});
	});

const waitForRemoteDesktopUpgradeRejection = (ticket, cookie) =>
	new Promise((resolve, reject) => {
		const socket = createSocket(ticket, cookie);
		const timer = setTimeout(() => {
			socket.terminate();
			reject(new Error('Timed out waiting for remote desktop HTTP upgrade rejection.'));
		}, 5_000);
		socket.once('unexpected-response', (_request, response) => {
			clearTimeout(timer);
			const statusCode = response.statusCode;
			response.resume();
			resolve({ statusCode });
		});
		socket.once('open', () => {
			clearTimeout(timer);
			socket.terminate();
			reject(new Error('Remote desktop WebSocket unexpectedly opened.'));
		});
		socket.once('error', () => {});
	});

module.exports = {
	openRemoteDesktopWebSocket,
	waitForRemoteDesktopTicketRejection,
	waitForRemoteDesktopUpgradeRejection,
};
